const crypto = require('crypto');
const { pool } = require('../config/db');
const { formatDoctorDisplay } = require('../services/emailService');
const { enqueueAppointmentEmail } = require('../services/appointmentEmailOutbox');
const {
    HOLD_MINUTES,
    expirePendingHolds,
    findScheduleConflict,
    lockAppointmentRoom
} = require('../services/appointmentHoldService');
const {
    getBookingWindow,
    getScheduleIntervals,
    isDateString,
    loadScheduleContext
} = require('../services/doctorScheduleService');

function timeToMinutes(value) {
    const [hours, minutes] = String(value).split(':').map(Number);
    return hours * 60 + minutes;
}

function minutesToTime(value) {
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}:00`;
}

function normalizeDegree(degree) {
    const map = {
        'Bác sĩ Chuyên khoa II': 'BS.CKII',
        'Bác sĩ Chuyên khoa I': 'BS.CKI',
        'Thạc sĩ Bác sĩ': 'ThS.BS',
        'Tiến sĩ Bác sĩ': 'TS.BS',
        'Bác sĩ CKI': 'BS.CKI',
        'Bác sĩ CKII': 'BS.CKII'
    };
    return map[degree] || degree || 'BS.';
}

function cleanDoctorName(name) {
    return String(name || '').replace(/^(BS\.CKII|BS\.CKI|ThS\.BS|TS\.BS|PGS\.TS|BS)\s+/i, '').trim();
}

async function getAppointmentResponse(executor, appointmentId) {
    const [rows] = await executor.execute(
        `SELECT a.*, d.degree AS doctor_degree, d.room_number, u.full_name AS doctor_name,
                s.name AS specialty_name,
                (SELECT outbox.status FROM appointment_email_outbox outbox
                 WHERE outbox.appointment_id = a.id AND outbox.event_type = 'received'
                 LIMIT 1) AS email_delivery_status
         FROM appointments a
         JOIN doctors d ON a.doctor_id = d.id
         JOIN users u ON d.user_id = u.id
         JOIN specialties s ON a.specialty_id = s.id
         WHERE a.id = ? LIMIT 1 FOR UPDATE`,
        [appointmentId]
    );
    if (!rows.length) return null;
    const appointment = rows[0];
    appointment.doctor_degree = normalizeDegree(appointment.doctor_degree);
    appointment.doctor_name = cleanDoctorName(appointment.doctor_name);
    appointment.doctor_display = formatDoctorDisplay(appointment.doctor_degree, appointment.doctor_name);
    appointment.room_number = appointment.room_number.replace(/^P\./, 'Phòng ').replace(' - ', ' – ');
    return appointment;
}

async function createAppointment(req, res) {
    let connection;
    let transactionStarted = false;
    const body = req.body || {};
    const idempotencyKey = String(body.idempotency_key || '');
    let requestFingerprint = '';

    try {
        const specialtyId = Number(body.specialty_id);
        const doctorId = Number(body.doctor_id);
        const appointmentDate = String(body.appointment_date || '');
        const requestedTime = String(body.slot_time || '');
        const patientName = String(body.patient_name || '').trim();
        const patientPhone = String(body.patient_phone || '').trim();
        const patientEmail = String(body.patient_email || '').trim().toLowerCase();
        const patientReason = String(body.reason || '').trim();
        const patientGender = body.patient_gender;
        const patientDob = body.patient_dob || null;

        if (!Number.isInteger(specialtyId) || specialtyId < 1 ||
            !Number.isInteger(doctorId) || doctorId < 1 ||
            !isDateString(appointmentDate) ||
            !/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(requestedTime) ||
            !patientName || patientName.length > 100 ||
            !/^(0|\+84)[0-9]{8,10}$/.test(patientPhone) ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patientEmail) ||
            !['Nam', 'Nữ', 'Khác'].includes(patientGender) ||
            !patientReason || patientReason.length > 2000 ||
            (patientDob && !isDateString(String(patientDob)))) {
            return res.status(400).json({ success: false, message: 'Thông tin đặt lịch không hợp lệ. Vui lòng kiểm tra lại.' });
        }
        if (!/^[A-Za-z0-9._:-]{16,64}$/.test(idempotencyKey)) {
            return res.status(400).json({ success: false, message: 'Thiếu mã yêu cầu đặt lịch hợp lệ. Vui lòng gửi lại.' });
        }

        const slotTime = requestedTime.length === 5 ? `${requestedTime}:00` : requestedTime;
        requestFingerprint = crypto.createHash('sha256').update(JSON.stringify({
            specialtyId, doctorId, appointmentDate, slotTime, patientName, patientPhone,
            patientEmail, patientReason, patientGender, patientDob
        })).digest('hex');

        connection = await pool.getConnection();
        await expirePendingHolds(connection);
        await connection.beginTransaction();
        transactionStarted = true;

        const [duplicateRequests] = await connection.execute(
            'SELECT id, request_fingerprint FROM appointments WHERE idempotency_key = ? LIMIT 1',
            [idempotencyKey]
        );
        if (duplicateRequests.length) {
            if (duplicateRequests[0].request_fingerprint !== requestFingerprint) {
                await connection.rollback();
                transactionStarted = false;
                return res.status(409).json({ success: false, message: 'Mã yêu cầu này đã được dùng cho thông tin đặt lịch khác.' });
            }
            const appointment = await getAppointmentResponse(connection, duplicateRequests[0].id);
            await connection.commit();
            transactionStarted = false;
            return res.status(200).json({
                success: true,
                message: 'Yêu cầu đặt lịch đã được tiếp nhận trước đó.',
                data: { ...appointment, email_status: appointment.email_delivery_status || 'unknown' }
            });
        }

        const [doctorRows] = await connection.execute(
            `SELECT d.id, d.specialty_id, d.degree, d.room_number, u.full_name AS doctor_name,
                    s.name AS specialty_name
             FROM doctors d
             JOIN users u ON d.user_id = u.id
             JOIN specialties s ON d.specialty_id = s.id
             WHERE d.id = ? AND d.specialty_id = ? AND d.is_active = 1
               AND u.is_active = 1 AND s.is_active = 1 LIMIT 1`,
            [doctorId, specialtyId]
        );
        if (!doctorRows.length) {
            await connection.rollback();
            transactionStarted = false;
            return res.status(400).json({ success: false, message: 'Bác sĩ không tồn tại hoặc không còn hoạt động.' });
        }
        const doctor = doctorRows[0];

        // The room lock serializes bookings for both this doctor and any doctor assigned to the same room.
        await lockAppointmentRoom(connection, doctor.room_number);
        const [concurrentDuplicates] = await connection.execute(
            'SELECT id, request_fingerprint FROM appointments WHERE idempotency_key = ? LIMIT 1 FOR UPDATE',
            [idempotencyKey]
        );
        if (concurrentDuplicates.length) {
            if (concurrentDuplicates[0].request_fingerprint !== requestFingerprint) {
                await connection.rollback();
                transactionStarted = false;
                return res.status(409).json({ success: false, message: 'Mã yêu cầu này đã được dùng cho thông tin đặt lịch khác.' });
            }
            const appointment = await getAppointmentResponse(connection, concurrentDuplicates[0].id);
            await connection.commit();
            transactionStarted = false;
            return res.status(200).json({ success: true, message: 'Yêu cầu đặt lịch đã được tiếp nhận trước đó.', data: appointment });
        }
        const [activeDoctorRows] = await connection.execute(
            `SELECT d.id, d.specialty_id, d.degree, d.room_number, u.full_name AS doctor_name,
                    s.name AS specialty_name
             FROM doctors d
             JOIN users u ON d.user_id = u.id
             JOIN specialties s ON d.specialty_id = s.id
             WHERE d.id = ? AND d.specialty_id = ? AND d.is_active = 1
               AND u.is_active = 1 AND s.is_active = 1 LIMIT 1`,
            [doctorId, specialtyId]
        );
        if (!activeDoctorRows.length) {
            await connection.rollback();
            transactionStarted = false;
            return res.status(400).json({ success: false, message: 'Bác sĩ không tồn tại hoặc không còn hoạt động.' });
        }
        if (activeDoctorRows[0].room_number !== doctor.room_number) {
            await connection.rollback();
            transactionStarted = false;
            return res.status(409).json({ success: false, message: 'Thông tin phòng khám vừa thay đổi. Vui lòng gửi lại yêu cầu.' });
        }

        const window = await getBookingWindow(connection);
        if (appointmentDate < window.startDate || appointmentDate > window.endDate) {
            await connection.rollback();
            transactionStarted = false;
            return res.status(400).json({ success: false, message: 'Ngày khám nằm ngoài thời gian đặt lịch.' });
        }
        if (appointmentDate === window.startDate) {
            const [[clock]] = await connection.execute('SELECT CURTIME() AS now_time');
            if (timeToMinutes(slotTime) <= timeToMinutes(String(clock.now_time))) {
                await connection.rollback();
                transactionStarted = false;
                return res.status(400).json({ success: false, message: 'Không thể đặt khung giờ đã qua trong ngày hôm nay.' });
            }
        }

        const schedule = await loadScheduleContext(connection, doctorId, appointmentDate, appointmentDate);
        const intervals = getScheduleIntervals(schedule, appointmentDate);
        let matchedInterval = null;
        let endTime = null;
        const startMinutes = timeToMinutes(slotTime);
        for (const interval of intervals) {
            const intervalStart = timeToMinutes(interval.start_time);
            const intervalEnd = timeToMinutes(interval.end_time);
            const duration = Number(interval.slot_duration) || 30;
            if (startMinutes >= intervalStart &&
                startMinutes + duration <= intervalEnd &&
                (startMinutes - intervalStart) % duration === 0) {
                matchedInterval = interval;
                endTime = minutesToTime(startMinutes + duration);
                break;
            }
        }
        if (!matchedInterval) {
            await connection.rollback();
            transactionStarted = false;
            return res.status(400).json({ success: false, message: 'Khung giờ không nằm trong lịch làm việc hợp lệ của bác sĩ.' });
        }

        const conflicts = await findScheduleConflict(connection, {
            doctorId,
            roomNumber: doctor.room_number,
            appointmentDate,
            slotTime,
            endTime
        });
        if (conflicts.length) {
            await connection.rollback();
            transactionStarted = false;
            return res.status(409).json({
                success: false,
                code: 'APPOINTMENT_SLOT_TAKEN',
                message: 'Khung giờ này vừa có người đặt, vui lòng chọn khung giờ khác.'
            });
        }

        let shiftId = matchedInterval.id || null;
        if (shiftId) {
            const [[activeShift]] = await connection.execute(
                `SELECT id FROM doctor_shifts
                 WHERE id = ? AND status = 'active' FOR UPDATE`,
                [shiftId]
            );
            shiftId = activeShift?.id || null;
        } else {
            for (const interval of intervals.filter(item => !item.id)) {
                const [insertedShift] = await connection.execute(
                    `INSERT INTO doctor_shifts
                        (doctor_id, shift_date, start_time, end_time, slot_duration, status, is_demo)
                     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
                    [
                        doctorId, appointmentDate, interval.start_time, interval.end_time,
                        Number(interval.slot_duration) || 30, interval.is_demo ? 1 : 0
                    ]
                );
                if (interval.start_time === matchedInterval.start_time && interval.end_time === matchedInterval.end_time) {
                    shiftId = insertedShift.insertId;
                }
            }
        }
        if (!shiftId) {
            await connection.rollback();
            transactionStarted = false;
            return res.status(409).json({ success: false, message: 'Lịch làm việc vừa thay đổi. Vui lòng chọn ngày khác.' });
        }

        const [patients] = await connection.execute('SELECT id FROM patients WHERE phone = ? LIMIT 1', [patientPhone]);
        let patientId;
        if (patients.length) {
            patientId = patients[0].id;
            await connection.execute(
                'UPDATE patients SET full_name = ?, email = ?, date_of_birth = ?, gender = ? WHERE id = ?',
                [patientName, patientEmail, patientDob, patientGender, patientId]
            );
        } else {
            const [patient] = await connection.execute(
                'INSERT INTO patients (full_name, phone, email, date_of_birth, gender) VALUES (?, ?, ?, ?, ?)',
                [patientName, patientPhone, patientEmail, patientDob, patientGender]
            );
            patientId = patient.insertId;
        }

        const compactDate = appointmentDate.replace(/-/g, '');
        let appointmentCode = '';
        for (let attempt = 0; attempt < 10; attempt++) {
            const [countRows] = await connection.execute(
                'SELECT COUNT(*) AS count FROM appointments WHERE appointment_date = ?',
                [appointmentDate]
            );
            const candidate = `HT-${compactDate}-${String(Number(countRows[0].count) + attempt + 1).padStart(3, '0')}`;
            const [matches] = await connection.execute(
                'SELECT id FROM appointments WHERE appointment_code = ? LIMIT 1',
                [candidate]
            );
            if (!matches.length) {
                appointmentCode = candidate;
                break;
            }
        }
        if (!appointmentCode) throw new Error('Không thể tạo mã lịch hẹn duy nhất.');

        const [inserted] = await connection.execute(
            `INSERT INTO appointments (
                appointment_code, patient_id, doctor_id, specialty_id, shift_id,
                appointment_date, slot_time, end_time, patient_name, patient_phone,
                patient_email, patient_dob, patient_gender, reason, status,
                hold_expires_at, schedule_source, idempotency_key, request_fingerprint
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending',
                       DATE_ADD(NOW(), INTERVAL ${HOLD_MINUTES} MINUTE), ?, ?, ?)`,
            [
                appointmentCode, patientId, doctorId, specialtyId, shiftId,
                appointmentDate, slotTime, endTime, patientName, patientPhone,
                patientEmail, patientDob, patientGender, patientReason,
                matchedInterval.is_demo ? 'demo' : 'clinic', idempotencyKey, requestFingerprint
            ]
        );
        await enqueueAppointmentEmail(connection, inserted.insertId, 'received');
        const appointment = await getAppointmentResponse(connection, inserted.insertId);
        await connection.commit();
        transactionStarted = false;
        return res.status(201).json({
            success: true,
            message: 'Yêu cầu đặt lịch đã được gửi và đang chờ duyệt.',
            data: { ...appointment, email_status: appointment.email_delivery_status || 'queued' }
        });
    } catch (error) {
        if (connection && transactionStarted) {
            await connection.rollback();
            transactionStarted = false;
        }
        if (error.code === 'ER_DUP_ENTRY') {
            if (idempotencyKey && requestFingerprint) {
                const [duplicates] = await connection.execute(
                    'SELECT id, request_fingerprint FROM appointments WHERE idempotency_key = ? LIMIT 1 FOR UPDATE',
                    [idempotencyKey]
                );
                if (duplicates.length) {
                    if (duplicates[0].request_fingerprint !== requestFingerprint) {
                        return res.status(409).json({ success: false, message: 'Mã yêu cầu này đã được dùng cho thông tin đặt lịch khác.' });
                    }
                    const appointment = await getAppointmentResponse(connection, duplicates[0].id);
                    return res.status(200).json({
                        success: true,
                        message: 'Yêu cầu đặt lịch đã được tiếp nhận trước đó.',
                        data: { ...appointment, email_status: appointment.email_delivery_status || 'unknown' }
                    });
                }
            }
            if (String(error.message).includes('active_slot_lock') ||
                String(error.message).includes('uq_active_doctor_slot')) {
                return res.status(409).json({
                    success: false,
                    code: 'APPOINTMENT_SLOT_TAKEN',
                    message: 'Khung giờ này vừa có người đặt, vui lòng chọn khung giờ khác.'
                });
            }
            return res.status(409).json({
                success: false,
                message: 'Thông tin liên hệ đang được dùng trong một yêu cầu khác. Vui lòng thử lại.'
            });
        }
        console.error('Không thể tạo yêu cầu đặt lịch:', error.message);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lưu yêu cầu đặt lịch.' });
    } finally {
        if (connection) connection.release();
    }
}

module.exports = { createAppointment };
