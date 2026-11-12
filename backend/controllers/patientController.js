const { pool } = require('../config/db');
const { sendAppointmentCreatedEmail, formatDoctorDisplay } = require('../services/emailService');
const { expirePendingHolds } = require('../services/appointmentHoldService');
const bookingController = require('./bookingController');
const {
    getBookingWindow,
    getScheduleIntervals,
    isDateString,
    listDates,
    loadScheduleContext
} = require('../services/doctorScheduleService');

function timeToMinutes(timeStr) {
    const parts = timeStr.split(':').map(Number);
    return parts[0] * 60 + parts[1];
}

function minutesToTime(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
}

function createSlots(shifts, bookedIntervals, date, today, nowMinutes) {
    const slots = [];
    for (const shift of shifts) {
        const startM = timeToMinutes(String(shift.start_time));
        const endM = timeToMinutes(String(shift.end_time));
        const step = Number(shift.slot_duration) || 30;

        for (let m = startM; m + step <= endM; m += step) {
            const startTime = minutesToTime(m);
            if (date === today && m <= nowMinutes) continue;
            const endTime = minutesToTime(m + step);
            slots.push({
                shift_id: shift.id || null,
                slot_time: startTime,
                end_time: endTime,
                label: `${startTime.slice(0, 5)} - ${endTime.slice(0, 5)}`,
                is_booked: bookedIntervals.some(interval => m < interval.end && m + step > interval.start)
            });
        }
    }
    return slots;
}

function normalizeDegree(degree) {
    const mapDegree = {
        'Bác sĩ Chuyên khoa II': 'BS.CKII',
        'Bác sĩ Chuyên khoa I': 'BS.CKI',
        'Thạc sĩ Bác sĩ': 'ThS.BS',
        'Tiến sĩ Bác sĩ': 'TS.BS',
        'Bác sĩ CKI': 'BS.CKI',
        'Bác sĩ CKII': 'BS.CKII'
    };
    return mapDegree[degree] || degree || 'BS.';
}

function cleanDoctorFullName(fullName) {
    return String(fullName || '').replace(/^(BS\.CKII|BS\.CKI|ThS\.BS|TS\.BS|PGS\.TS|BS)\s+/i, '').trim();
}

// 1. Lấy danh sách chuyên khoa đang hoạt động
async function getSpecialties(req, res) {
    try {
        const [rows] = await pool.execute(
            `SELECT s.id, s.name, s.code, s.description, s.icon_name, COUNT(d.id) AS doctor_count
             FROM specialties s
             LEFT JOIN doctors d ON s.id = d.specialty_id AND d.is_active = 1
             WHERE s.is_active = 1
             GROUP BY s.id ORDER BY s.id ASC`
        );
        return res.json({ success: true, data: rows });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Không thể tải danh sách chuyên khoa.' });
    }
}

// 2. Lấy danh sách bác sĩ công khai kèm lịch trực
async function getPublicDoctors(req, res) {
    try {
        const { specialty_id } = req.query;
        let query = `
            SELECT d.id, d.specialty_id, d.degree, d.phone, d.bio, d.room_number, d.experience_years,
                   u.full_name, u.email, s.name AS specialty_name
            FROM doctors d
            JOIN users u ON d.user_id = u.id
            JOIN specialties s ON d.specialty_id = s.id
            WHERE d.is_active = 1 AND u.is_active = 1 AND s.is_active = 1
        `;
        const params = [];
        if (specialty_id && specialty_id !== 'all') {
            query += ' AND d.specialty_id = ?';
            params.push(Number(specialty_id));
        }
        query += ' ORDER BY d.id ASC';
        const [doctors] = await pool.execute(query, params);

        const [shifts] = await pool.execute(
            `SELECT doctor_id, shift_date, start_time, end_time
             FROM doctor_shifts
             WHERE status = 'active' AND shift_date >= CURDATE()
             ORDER BY shift_date ASC, start_time ASC`
        );

        const data = doctors.map(doc => {
            const shortDeg = normalizeDegree(doc.degree);
            const pureName = cleanDoctorFullName(doc.full_name);
            const docShifts = shifts.filter(s => s.doctor_id === doc.id);
            return {
                ...doc,
                degree: shortDeg,
                full_name: pureName,
                display_name: `${shortDeg} ${pureName}`,
                room_number: doc.room_number.replace(/^P\./, 'Phòng ').replace(' - ', ' – '),
                upcoming_shifts: docShifts.slice(0, 5),
                nearest_shift: docShifts.length > 0 ? docShifts[0] : null
            };
        });

        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Không thể tải danh sách bác sĩ.' });
    }
}

// 3. Lấy ngày khả dụng từ ca trực, lịch tuần và ngoại lệ trong cửa sổ đặt lịch.
async function getDoctorAvailableDates(req, res) {
    let connection;
    try {
        connection = await pool.getConnection();
        await expirePendingHolds(connection);
        const doctorId = Number(req.params.doctorId);
        if (!Number.isInteger(doctorId) || doctorId < 1) {
            return res.status(400).json({ success: false, message: 'Mã bác sĩ không hợp lệ.' });
        }

        const window = await getBookingWindow(connection);
        const context = await loadScheduleContext(connection, doctorId, window.startDate, window.endDate);
        if (!context) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy bác sĩ đang hoạt động.' });
        }

        const [appointments] = await connection.execute(
            `SELECT a.appointment_date, a.slot_time, a.end_time
             FROM appointments a
             JOIN doctors booked_doctor ON booked_doctor.id = a.doctor_id
             JOIN doctors selected_doctor ON selected_doctor.id = ?
             WHERE (a.doctor_id = ? OR booked_doctor.room_number = selected_doctor.room_number)
               AND a.appointment_date BETWEEN ? AND ?
               AND (a.status IN ('confirmed', 'completed')
                    OR (a.status = 'pending' AND a.hold_expires_at > NOW()))`,
            [doctorId, doctorId, window.startDate, window.endDate]
        );
        const bookedByDate = new Map();
        for (const appointment of appointments) {
            const date = String(appointment.appointment_date).slice(0, 10);
            if (!bookedByDate.has(date)) bookedByDate.set(date, []);
            bookedByDate.get(date).push({
                start: timeToMinutes(String(appointment.slot_time)),
                end: timeToMinutes(String(appointment.end_time))
            });
        }

        const [[dbNow]] = await connection.execute('SELECT CURTIME() AS now_time');
        const todayNowMinutes = timeToMinutes(String(dbNow.now_time));
        const dates = listDates(window.startDate, window.endDate).filter(date => {
            const shifts = getScheduleIntervals(context, date);
            const slots = createSlots(
                shifts,
                bookedByDate.get(date) || [],
                date,
                window.startDate,
                todayNowMinutes
            );
            return slots.some(slot => !slot.is_booked);
        });
        const scheduleSource = dates.some(date =>
            getScheduleIntervals(context, date).some(interval => Number(interval.is_demo) === 1)
        ) ? 'demo' : 'clinic';
        return res.json({
            success: true,
            data: dates,
            booking_window_start: window.startDate,
            booking_window_end: window.endDate,
            timezone: '+07:00',
            schedule_source: scheduleSource
        });
    } catch (error) {
        console.error('Không thể tải ngày khám:', error.message);
        return res.status(500).json({ success: false, message: 'Không thể tải ngày khám.' });
    } finally {
        if (connection) connection.release();
    }
}

// 4. Lấy các khung giờ khám trong ngày (Đánh dấu rõ slot đã đặt).
async function getDoctorAvailableSlots(req, res) {
    let connection;
    try {
        connection = await pool.getConnection();
        await expirePendingHolds(connection);
        const doctorId = Number(req.params.doctorId);
        const { date } = req.query;

        if (!Number.isInteger(doctorId) || doctorId < 1 || !isDateString(date)) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin bác sĩ hoặc ngày khám.' });
        }

        const window = await getBookingWindow(connection);
        if (date < window.startDate || date > window.endDate) {
            return res.status(400).json({ success: false, message: 'Ngày khám nằm ngoài thời gian đặt lịch.' });
        }

        const context = await loadScheduleContext(connection, doctorId, date, date);
        if (!context) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy bác sĩ đang hoạt động.' });
        }
        const [appointments] = await connection.execute(
            `SELECT a.slot_time, a.end_time FROM appointments a
             JOIN doctors booked_doctor ON booked_doctor.id = a.doctor_id
             JOIN doctors selected_doctor ON selected_doctor.id = ?
             WHERE (a.doctor_id = ? OR booked_doctor.room_number = selected_doctor.room_number)
               AND a.appointment_date = ?
               AND (a.status IN ('confirmed', 'completed')
                    OR (a.status = 'pending' AND a.hold_expires_at > NOW()))`,
            [doctorId, doctorId, date]
        );
        const bookedIntervals = appointments.map(row => ({
            start: timeToMinutes(String(row.slot_time)),
            end: timeToMinutes(String(row.end_time))
        }));
        const [[dbNow]] = await connection.execute('SELECT CURTIME() AS now_time');
        const intervals = getScheduleIntervals(context, date);
        const slots = createSlots(
            intervals,
            bookedIntervals,
            date,
            window.startDate,
            timeToMinutes(String(dbNow.now_time))
        );
        const scheduleSource = intervals.some(interval => Number(interval.is_demo) === 1) ? 'demo' : 'clinic';
        return res.json({
            success: true,
            data: slots,
            booking_window_start: window.startDate,
            booking_window_end: window.endDate,
            timezone: '+07:00',
            schedule_source: scheduleSource
        });
    } catch (error) {
        console.error('Không thể tải khung giờ khám:', error.message);
        return res.status(500).json({ success: false, message: 'Không thể tải khung giờ khám.' });
    } finally {
        if (connection) connection.release();
    }
}

// 5. Đặt lịch khám (Transaction FOR UPDATE + Chặn ngày quá khứ + Sinh mã HT-YYYYMMDD-xxx)
async function createAppointment(req, res) {
    const connection = await pool.getConnection();
    try {
        const {
            specialty_id, doctor_id, appointment_date, slot_time,
            patient_name, patient_phone, patient_email, patient_dob, patient_gender, reason
        } = req.body;

        if (!specialty_id || !doctor_id || !appointment_date || !slot_time || !patient_name || !patient_phone || !patient_email || !reason) {
            connection.release();
            return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ các trường thông tin bắt buộc.' });
        }

        if (!isDateString(appointment_date)) {
            connection.release();
            return res.status(400).json({ success: false, message: 'Ngày khám không đúng định dạng YYYY-MM-DD.' });
        }

        const window = await getBookingWindow(connection);
        const todayStr = window.startDate;
        if (appointment_date < window.startDate || appointment_date > window.endDate) {
            connection.release();
            return res.status(400).json({ success: false, message: 'Ngày khám nằm ngoài thời gian đặt lịch.' });
        }

        const cleanName = String(patient_name).trim();
        const cleanPhone = String(patient_phone).trim();
        const cleanEmail = String(patient_email).trim().toLowerCase();
        const cleanReason = String(reason).trim();

        if (!/^(0|\+84)[0-9]{8,10}$/.test(cleanPhone)) {
            connection.release();
            return res.status(400).json({ success: false, message: 'Số điện thoại không hợp lệ (cần 9–11 chữ số).' });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            connection.release();
            return res.status(400).json({ success: false, message: 'Địa chỉ email không đúng định dạng.' });
        }

        const normSlot = slot_time.length === 5 ? `${slot_time}:00` : slot_time;

        // Chặn đặt khung giờ đã qua trong ngày hiện tại
        if (appointment_date === todayStr) {
            const [[dbNow]] = await connection.execute('SELECT CURTIME() AS now_time');
            const nowMinutes = timeToMinutes(String(dbNow.now_time));
            if (timeToMinutes(normSlot) <= nowMinutes) {
                connection.release();
                return res.status(400).json({ success: false, message: 'Không thể đặt khung giờ đã qua trong ngày hôm nay.' });
            }
        }

        await connection.beginTransaction();

        const [doctors] = await connection.execute(
            `SELECT d.id, d.degree, d.room_number, u.full_name AS doctor_name, s.name AS specialty_name
             FROM doctors d JOIN users u ON d.user_id = u.id JOIN specialties s ON d.specialty_id = s.id
             WHERE d.id = ? AND d.specialty_id = ? AND d.is_active = 1 AND u.is_active = 1 LIMIT 1`,
            [Number(doctor_id), Number(specialty_id)]
        );
        if (doctors.length === 0) {
            await connection.rollback(); connection.release();
            return res.status(400).json({ success: false, message: 'Bác sĩ hoặc chuyên khoa không hợp lệ.' });
        }

        const scheduleContext = await loadScheduleContext(
            connection,
            Number(doctor_id),
            appointment_date,
            appointment_date
        );
        const shifts = getScheduleIntervals(scheduleContext, appointment_date);
        if (shifts.length === 0) {
            await connection.rollback(); connection.release();
            return res.status(400).json({ success: false, message: 'Bác sĩ không có lịch trực vào ngày bạn chọn.' });
        }

        const reqM = timeToMinutes(normSlot);
        let matchedShift = null;
        let matchedSchedule = null;
        let calculatedEndTime = null;
        for (const sh of shifts) {
            const sM = timeToMinutes(sh.start_time);
            const eM = timeToMinutes(sh.end_time);
            const dur = Number(sh.slot_duration) || 30;
            if (reqM >= sM && (reqM + dur) <= eM && ((reqM - sM) % dur === 0)) {
                matchedSchedule = sh;
                calculatedEndTime = minutesToTime(reqM + dur);
                break;
            }
        }
        if (!matchedSchedule) {
            await connection.rollback(); connection.release();
            return res.status(400).json({ success: false, message: 'Khung giờ đã chọn nằm ngoài ca trực của bác sĩ.' });
        }

        if (matchedSchedule.id) {
            const [[lockedShift]] = await connection.execute(
                `SELECT id FROM doctor_shifts
                 WHERE id = ? AND status = 'active' FOR UPDATE`,
                [matchedSchedule.id]
            );
            matchedShift = lockedShift || null;
        } else {
            const virtualShifts = shifts.filter(shift => !shift.id);
            for (const shift of virtualShifts) {
                const [materializedShift] = await connection.execute(
                    `INSERT INTO doctor_shifts
                        (doctor_id, shift_date, start_time, end_time, slot_duration, status, is_demo)
                     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
                    [
                        Number(doctor_id),
                        appointment_date,
                        shift.start_time,
                        shift.end_time,
                        Number(shift.slot_duration) || 30,
                        shift.is_demo ? 1 : 0
                    ]
                );
                if (shift.start_time === matchedSchedule.start_time && shift.end_time === matchedSchedule.end_time) {
                    matchedShift = { id: materializedShift.insertId };
                }
            }
        }

        if (!matchedShift) {
            await connection.rollback(); connection.release();
            return res.status(400).json({ success: false, message: 'Ca trực đã bị thay đổi. Vui lòng chọn lại ngày khám.' });
        }

        const [existing] = await connection.execute(
            `SELECT id FROM appointments
             WHERE doctor_id = ? AND appointment_date = ? AND slot_time = ?
               AND status IN ('pending', 'confirmed', 'completed') FOR UPDATE`,
            [Number(doctor_id), appointment_date, normSlot]
        );
        if (existing.length > 0) {
            await connection.rollback(); connection.release();
            return res.status(409).json({
                success: false,
                message: 'Khung giờ này vừa có bệnh nhân khác đặt. Vui lòng chọn khung giờ khác.'
            });
        }

        const [patients] = await connection.execute('SELECT id FROM patients WHERE phone = ? LIMIT 1', [cleanPhone]);
        let patientId;
        if (patients.length > 0) {
            patientId = patients[0].id;
            await connection.execute(
                'UPDATE patients SET full_name = ?, email = ? WHERE id = ?',
                [cleanName, cleanEmail, patientId]
            );
        } else {
            const [ins] = await connection.execute(
                'INSERT INTO patients (full_name, phone, email, date_of_birth, gender) VALUES (?, ?, ?, ?, ?)',
                [cleanName, cleanPhone, cleanEmail, patient_dob || null, patient_gender || 'Nam']
            );
            patientId = ins.insertId;
        }

        // Sinh mã lịch hẹn duy nhất theo định dạng ảnh mẫu: HT-YYYYMMDD-xxx (VD: HT-20261029-001)
        // Dùng retry để tránh race condition khi nhiều request cùng sinh mã.
        const compactDate = appointment_date.replace(/-/g, '');
        let appointmentCode = null;
        let inserted = false;

        for (let attempt = 0; attempt < 5; attempt++) {
            const [countRows] = await connection.execute(
                'SELECT COUNT(*) AS cnt FROM appointments WHERE appointment_date = ?',
                [appointment_date]
            );
            let seq = (countRows[0]?.cnt || 0) + 1 + attempt;
            appointmentCode = `HT-${compactDate}-${String(seq).padStart(3, '0')}`;

            const [dupCheck] = await connection.execute(
                'SELECT id FROM appointments WHERE appointment_code = ? LIMIT 1',
                [appointmentCode]
            );
            if (dupCheck.length > 0) {
                appointmentCode = `HT-${compactDate}-${Math.floor(100 + Math.random() * 900)}`;
            }

            try {
                await connection.execute(
                    `INSERT INTO appointments (
                        appointment_code, patient_id, doctor_id, specialty_id, shift_id,
                        appointment_date, slot_time, end_time,
                        patient_name, patient_phone, patient_email, patient_dob, patient_gender,
                        reason, status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
                    [
                        appointmentCode, patientId, Number(doctor_id), Number(specialty_id), matchedShift.id,
                        appointment_date, normSlot, calculatedEndTime,
                        cleanName, cleanPhone, cleanEmail, patient_dob || null, patient_gender || 'Nam', cleanReason
                    ]
                );
                inserted = true;
                break;
            } catch (insertError) {
                if (insertError && insertError.code === 'ER_DUP_ENTRY') {
                    const msg = String(insertError.message || '');
                    if (msg.includes('uq_active_doctor_slot') || msg.includes('active_slot_lock')) {
                        await connection.rollback();
                        connection.release();
                        return res.status(409).json({
                            success: false,
                            message: 'Khung giờ này vừa có bệnh nhân khác đặt. Vui lòng chọn khung giờ khác.'
                        });
                    }
                    // Trùng mã lịch hẹn: thử lại với seq mới
                    continue;
                }
                throw insertError;
            }
        }

        if (!inserted) {
            await connection.rollback();
            connection.release();
            return res.status(500).json({ success: false, message: 'Không thể sinh mã lịch hẹn duy nhất. Vui lòng thử lại.' });
        }

        await connection.commit();
        connection.release();

        const shortDegree = normalizeDegree(doctors[0].degree);
        const pureDocName = cleanDoctorFullName(doctors[0].doctor_name);
        const cleanRoom = doctors[0].room_number.replace(/^P\./, 'Phòng ').replace(' - ', ' – ');

        const emailInfo = {
            appointment_code: appointmentCode,
            patient_name: cleanName,
            patient_phone: cleanPhone,
            patient_email: cleanEmail,
            specialty_name: doctors[0].specialty_name,
            doctor_name: pureDocName,
            doctor_degree: shortDegree,
            doctor_display: formatDoctorDisplay(shortDegree, pureDocName),
            room_number: cleanRoom,
            appointment_date,
            slot_time: normSlot,
            end_time: calculatedEndTime
        };

        const emailStatus = await sendAppointmentCreatedEmail(emailInfo);

        return res.status(201).json({
            success: true,
            message: 'Đặt lịch khám thành công!',
            data: { ...emailInfo, status: 'pending', email_notification: emailStatus }
        });
    } catch (error) {
        await connection.rollback();
        connection.release();
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                message: 'Khung giờ này đã được đặt kín bởi một yêu cầu đồng thời. Vui lòng chọn khung giờ khác.'
            });
        }
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lưu lịch hẹn.' });
    }
}

// 6. Tra cứu lịch hẹn (Bảo mật 2 lớp: Mã lịch hẹn + SĐT/Email)
async function lookupAppointment(req, res) {
    try {
        const { appointment_code, verifier } = req.body;
        if (!appointment_code || !verifier) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập đầy đủ Mã lịch hẹn và Số điện thoại.' });
        }

        const [rows] = await pool.execute(
            `SELECT a.*, d.degree AS doctor_degree, d.room_number, u.full_name AS doctor_name, s.name AS specialty_name
             FROM appointments a 
             JOIN doctors d ON a.doctor_id = d.id 
             JOIN users u ON d.user_id = u.id 
             JOIN specialties s ON a.specialty_id = s.id
             WHERE a.appointment_code = ? AND (a.patient_phone = ? OR LOWER(a.patient_email) = ?) LIMIT 1`,
            [appointment_code.trim().toUpperCase(), verifier.trim(), verifier.trim().toLowerCase()]
        );
        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy lịch hẹn khớp với Mã lịch hẹn và Số điện thoại đã nhập.'
            });
        }

        const item = rows[0];
        item.doctor_degree = normalizeDegree(item.doctor_degree);
        item.doctor_name = cleanDoctorFullName(item.doctor_name);
        item.room_number = item.room_number.replace(/^P\./, 'Phòng ').replace(' - ', ' – ');

        return res.json({ success: true, data: item });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tra cứu lịch hẹn.' });
    }
}

// 7. Bệnh nhân hủy lịch hẹn
async function cancelAppointmentByPatient(req, res) {
    let connection;
    let transactionStarted = false;
    try {
        const { appointment_code, verifier, cancel_reason } = req.body;
        if (typeof appointment_code !== 'string' || typeof verifier !== 'string' || !appointment_code.trim() || !verifier.trim()) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập mã lịch hẹn và thông tin xác minh.' });
        }
        connection = await pool.getConnection();
        await connection.beginTransaction();
        transactionStarted = true;
        const [rows] = await connection.execute(
            `SELECT id, status FROM appointments
             WHERE appointment_code = ? AND (patient_phone = ? OR LOWER(patient_email) = ?)
             LIMIT 1 FOR UPDATE`,
            [appointment_code.trim().toUpperCase(), verifier.trim(), verifier.trim().toLowerCase()]
        );
        if (!rows.length) {
            await connection.rollback();
            transactionStarted = false;
            return res.status(404).json({ success: false, message: 'Thông tin xác minh không chính xác.' });
        }

        const appt = rows[0];
        await expirePendingHolds(connection, appt.id);
        const [[currentAppointment]] = await connection.execute(
            'SELECT status FROM appointments WHERE id = ? FOR UPDATE',
            [appt.id]
        );
        if (!['pending', 'confirmed'].includes(currentAppointment.status)) {
            await connection.rollback();
            transactionStarted = false;
            return res.status(400).json({ success: false, message: 'Yêu cầu này đã được xử lý hoặc không còn có thể hủy.' });
        }
        await connection.execute(
            `UPDATE appointments SET status = 'cancelled', cancel_reason = ?
             WHERE id = ? AND status IN ('pending', 'confirmed')`,
            [String(cancel_reason || 'Bệnh nhân chủ động hủy trực tuyến').slice(0, 255), appt.id]
        );
        await connection.commit();
        transactionStarted = false;
        return res.json({ success: true, message: 'Đã hủy lịch hẹn thành công.' });
    } catch (error) {
        if (connection && transactionStarted) await connection.rollback();
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi hủy lịch hẹn.' });
    } finally {
        if (connection) connection.release();
    }
}

// 8. Gửi biểu mẫu Liên hệ
async function submitContactForm(req, res) {
    try {
        const { full_name, phone, email, subject, message } = req.body;
        if (!full_name || !phone || !message) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập Họ tên, Số điện thoại và Nội dung liên hệ.' });
        }

        if (email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(String(email).trim())) {
            return res.status(400).json({ success: false, message: 'Địa chỉ email không đúng định dạng.' });
        }

        await pool.execute(
            'INSERT INTO contact_messages (full_name, phone, email, subject, message) VALUES (?, ?, ?, ?, ?)',
            [full_name.trim(), phone.trim(), email ? email.trim() : null, subject ? subject.trim() : null, message.trim()]
        );

        return res.status(201).json({
            success: true,
            message: 'Cảm ơn bạn! Phòng khám Đa khoa Hiếu Tâm đã ghi nhận thông tin liên hệ và sẽ phản hồi sớm nhất.'
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Không thể gửi biểu mẫu liên hệ lúc này.' });
    }
}

module.exports = {
    getSpecialties, getPublicDoctors, getDoctorAvailableDates, getDoctorAvailableSlots,
    createAppointment: bookingController.createAppointment,
    lookupAppointment, cancelAppointmentByPatient, submitContactForm
};