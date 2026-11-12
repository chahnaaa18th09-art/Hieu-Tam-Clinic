const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { formatDoctorDisplay } = require('../services/emailService');
const { enqueueAppointmentEmail } = require('../services/appointmentEmailOutbox');
const {
    HOLD_MINUTES,
    expirePendingHolds,
    expirePendingHoldsFromPool,
    findScheduleConflict,
    lockAppointmentRoom
} = require('../services/appointmentHoldService');
const { getScheduleIntervals, loadScheduleContext } = require('../services/doctorScheduleService');

async function getDashboardStats(req, res) {
    try {
        const [[pat]] = await pool.execute('SELECT COUNT(*) AS total FROM patients');
        const [[doc]] = await pool.execute('SELECT COUNT(*) AS total FROM doctors WHERE is_active = 1');
        const [[spc]] = await pool.execute('SELECT COUNT(*) AS total FROM specialties WHERE is_active = 1');
        const [[apt]] = await pool.execute(`
            SELECT
                COUNT(*) AS total_appointments,
                SUM(CASE WHEN appointment_date = CURDATE() THEN 1 ELSE 0 END) AS today_appointments,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
                SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed_count,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
                SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
                SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired_count
            FROM appointments
        `);

        // Thống kê số lượng lịch hẹn theo 7 ngày gần nhất để vẽ biểu đồ đường
        const [dailyRows] = await pool.execute(`
            SELECT appointment_date, COUNT(*) AS count
            FROM appointments
            WHERE appointment_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
              AND appointment_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
            GROUP BY appointment_date
            ORDER BY appointment_date ASC
            LIMIT 7
        `);

        const [recent] = await pool.execute(`
            SELECT a.*, d.degree AS doctor_degree, u.full_name AS doctor_name, s.name AS specialty_name
            FROM appointments a 
            JOIN doctors d ON a.doctor_id = d.id
            JOIN users u ON d.user_id = u.id 
            JOIN specialties s ON a.specialty_id = s.id
            ORDER BY a.created_at DESC LIMIT 8
        `);

        const formattedRecent = recent.map(r => ({
            ...r,
            doctor_display: formatDoctorDisplay(r.doctor_degree, r.doctor_name)
        }));

        return res.json({
            success: true,
            data: {
                counts: {
                    patients: pat.total || 0,
                    doctors: doc.total || 0,
                    specialties: spc.total || 0,
                    total_appointments: Number(apt.total_appointments) || 0,
                    today_appointments: Number(apt.today_appointments) || 0,
                    pending: Number(apt.pending_count) || 0,
                    confirmed: Number(apt.confirmed_count) || 0,
                    waiting_exam: (Number(apt.pending_count) || 0) + (Number(apt.confirmed_count) || 0),
                    completed: Number(apt.completed_count) || 0,
                    cancelled: Number(apt.cancelled_count) || 0,
                    rejected: Number(apt.rejected_count) || 0,
                    expired: Number(apt.expired_count) || 0
                },
                appointment_hold_minutes: HOLD_MINUTES,
                daily_chart: dailyRows,
                recent_appointments: formattedRecent
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi tải thống kê Admin.' });
    }
}

async function getAllSpecialtiesAdmin(req, res) {
    try {
        const [rows] = await pool.execute(`
            SELECT s.*, COUNT(d.id) AS doctor_count FROM specialties s
            LEFT JOIN doctors d ON s.id = d.specialty_id AND d.is_active = 1
            GROUP BY s.id ORDER BY s.id ASC
        `);
        return res.json({ success: true, data: rows });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi tải danh sách chuyên khoa.' });
    }
}

async function createSpecialty(req, res) {
    try {
        const { name, code, description } = req.body;
        if (!name || !code || !description) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập đủ tên, mã và mô tả chuyên khoa.' });
        }
        await pool.execute(
            'INSERT INTO specialties (name, code, description, is_active) VALUES (?, ?, ?, 1)',
            [name.trim(), code.trim().toUpperCase(), description.trim()]
        );
        return res.status(201).json({ success: true, message: 'Thêm chuyên khoa thành công.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Tên hoặc mã chuyên khoa đã tồn tại.' });
    }
}

async function updateSpecialty(req, res) {
    try {
        const id = Number(req.params.id);
        const { name, description, is_active } = req.body;
        await pool.execute(
            'UPDATE specialties SET name = COALESCE(?, name), description = COALESCE(?, description), is_active = COALESCE(?, is_active) WHERE id = ?',
            [name ? name.trim() : null, description ? description.trim() : null, is_active !== undefined ? Number(is_active) : null, id]
        );
        return res.json({ success: true, message: 'Cập nhật chuyên khoa thành công.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi khi cập nhật chuyên khoa.' });
    }
}

async function getAllDoctorsAdmin(req, res) {
    try {
        const [rows] = await pool.execute(`
            SELECT d.*, u.full_name, u.email, u.is_active AS user_active, s.name AS specialty_name
            FROM doctors d 
            JOIN users u ON d.user_id = u.id 
            JOIN specialties s ON d.specialty_id = s.id
            ORDER BY d.id ASC
        `);
        const data = rows.map(r => ({
            ...r,
            display_name: formatDoctorDisplay(r.degree, r.full_name)
        }));
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi tải danh sách bác sĩ.' });
    }
}

async function createDoctor(req, res) {
    const connection = await pool.getConnection();
    try {
        const { full_name, email, password, specialty_id, degree, phone, room_number, experience_years, bio } = req.body;
        if (!full_name || !email || !password || !specialty_id || !phone || !room_number) {
            connection.release();
            return res.status(400).json({ success: false, message: 'Vui lòng điền đủ thông tin bác sĩ.' });
        }

        const cleanName = String(full_name).replace(/^(BS\.CKII|BS\.CKI|ThS\.BS|TS\.BS|BS)\s+/i, '').trim();

        await connection.beginTransaction();

        const hash = await bcrypt.hash(password, 10);
        const [u] = await connection.execute(
            'INSERT INTO users (email, password_hash, full_name, role, is_active) VALUES (?, ?, ?, "doctor", 1)',
            [email.trim().toLowerCase(), hash, cleanName]
        );

        await connection.execute(
            'INSERT INTO doctors (user_id, specialty_id, degree, phone, bio, room_number, experience_years, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
            [u.insertId, Number(specialty_id), degree || 'BS.CKI', phone.trim(), bio || '', room_number.trim(), Number(experience_years) || 5]
        );

        await connection.commit(); 
        connection.release();
        return res.status(201).json({ success: true, message: 'Tạo tài khoản và hồ sơ bác sĩ thành công.' });
    } catch (error) {
        await connection.rollback(); 
        connection.release();
        return res.status(500).json({ success: false, message: 'Email bác sĩ đã tồn tại hoặc dữ liệu không hợp lệ.' });
    }
}

async function toggleDoctorActive(req, res) {
    const connection = await pool.getConnection();
    try {
        const doctorId = Number(req.params.id);
        const { is_active } = req.body;
        const flag = Number(is_active) ? 1 : 0;

        const [docs] = await connection.execute('SELECT user_id FROM doctors WHERE id = ? LIMIT 1', [doctorId]);
        if (docs.length === 0) {
            connection.release();
            return res.status(404).json({ success: false, message: 'Không tìm thấy bác sĩ.' });
        }

        await connection.beginTransaction();
        await connection.execute('UPDATE doctors SET is_active = ? WHERE id = ?', [flag, doctorId]);
        await connection.execute('UPDATE users SET is_active = ? WHERE id = ?', [flag, docs[0].user_id]);
        await connection.commit();
        connection.release();

        return res.json({ success: true, message: flag ? 'Đã kích hoạt lại bác sĩ.' : 'Đã tạm ngưng hoạt động bác sĩ.' });
    } catch (error) {
        await connection.rollback();
        connection.release();
        return res.status(500).json({ success: false, message: 'Không thể cập nhật trạng thái bác sĩ.' });
    }
}

async function getShiftsAdmin(req, res) {
    try {
        const { doctor_id, week_start, week_end } = req.query;
        let query = `
            SELECT sh.*, d.degree AS doctor_degree, u.full_name AS doctor_name, s.name AS specialty_name,
            (SELECT COUNT(*) FROM appointments a WHERE a.shift_id = sh.id AND a.status IN ('pending', 'confirmed', 'completed')) AS active_bookings
            FROM doctor_shifts sh 
            JOIN doctors d ON sh.doctor_id = d.id 
            JOIN users u ON d.user_id = u.id 
            JOIN specialties s ON d.specialty_id = s.id
            WHERE sh.status = 'active'
        `;
        const params = [];
        if (doctor_id && doctor_id !== 'all') {
            query += ' AND sh.doctor_id = ?';
            params.push(Number(doctor_id));
        }
        if (week_start) {
            query += ' AND sh.shift_date >= ?';
            params.push(week_start);
        }
        if (week_end) {
            query += ' AND sh.shift_date <= ?';
            params.push(week_end);
        }
        query += ' ORDER BY sh.shift_date ASC, sh.start_time ASC';
        const [rows] = await pool.execute(query, params);
        const data = rows.map(r => ({
            ...r,
            doctor_display: formatDoctorDisplay(r.doctor_degree, r.doctor_name)
        }));
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi tải danh sách ca trực.' });
    }
}

async function createShift(req, res) {
    try {
        const { doctor_id, shift_date, start_time, end_time, slot_duration } = req.body;

        // Kiểm tra bác sĩ tồn tại và đang hoạt động
        const [doctors] = await pool.execute(
            'SELECT id FROM doctors WHERE id = ? AND is_active = 1 LIMIT 1',
            [Number(doctor_id)]
        );
        if (doctors.length === 0) {
            return res.status(400).json({ success: false, message: 'Bác sĩ không tồn tại hoặc đã bị khóa.' });
        }

const [[dbToday]] = await pool.execute('SELECT CURDATE() AS today');
        const todayStr = String(dbToday.today);

        // Không cho tạo ca trực trong quá khứ
        if (String(shift_date) < todayStr) {
            return res.status(400).json({ success: false, message: 'Không thể tạo ca trực trong quá khứ.' });
        }

        const sTime = start_time.length === 5 ? `${start_time}:00` : start_time;
        const eTime = end_time.length === 5 ? `${end_time}:00` : end_time;

        if (eTime <= sTime) {
            return res.status(400).json({ success: false, message: 'Giờ kết thúc phải lớn hơn giờ bắt đầu.' });
        }

        const [overlaps] = await pool.execute(
            `SELECT id FROM doctor_shifts WHERE doctor_id = ? AND shift_date = ? AND status = 'active' AND (? < end_time AND start_time < ?)`,
            [Number(doctor_id), shift_date, sTime, eTime]
        );
        if (overlaps.length > 0) {
            return res.status(409).json({ success: false, message: 'Bác sĩ đã có ca trực trùng khung giờ này!' });
        }

        await pool.execute(
            'INSERT INTO doctor_shifts (doctor_id, shift_date, start_time, end_time, slot_duration) VALUES (?, ?, ?, ?, ?)',
            [Number(doctor_id), shift_date, sTime, eTime, Number(slot_duration) || 30]
        );
        return res.status(201).json({ success: true, message: 'Tạo ca trực mới thành công.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi tạo ca trực.' });
    }
}

async function updateShift(req, res) {
    try {
        const shiftId = Number(req.params.id);
        const { doctor_id, shift_date, start_time, end_time, slot_duration } = req.body;

        const [doctors] = await pool.execute(
            'SELECT id FROM doctors WHERE id = ? AND is_active = 1 LIMIT 1',
            [Number(doctor_id)]
        );
        if (doctors.length === 0) {
            return res.status(400).json({ success: false, message: 'Bác sĩ không tồn tại hoặc đã bị khóa.' });
        }

const [[dbToday]] = await pool.execute('SELECT CURDATE() AS today');
        const todayStr = String(dbToday.today);

        if (String(shift_date) < todayStr) {
            return res.status(400).json({ success: false, message: 'Không thể đặt ca trực trong quá khứ.' });
        }

        const [bookings] = await pool.execute(
            `SELECT COUNT(*) AS cnt FROM appointments WHERE shift_id = ? AND status IN ('pending', 'confirmed', 'completed')`,
            [shiftId]
        );
        if (bookings[0].cnt > 0) {
            return res.status(400).json({
                success: false,
                message: 'Không thể sửa giờ ca trực này vì đã có bệnh nhân đặt lịch trong ca.'
            });
        }

        const sTime = start_time.length === 5 ? `${start_time}:00` : start_time;
        const eTime = end_time.length === 5 ? `${end_time}:00` : end_time;

        if (eTime <= sTime) {
            return res.status(400).json({ success: false, message: 'Giờ kết thúc phải lớn hơn giờ bắt đầu.' });
        }

        const [overlaps] = await pool.execute(
            `SELECT id FROM doctor_shifts
             WHERE doctor_id = ? AND shift_date = ? AND status = 'active' AND id != ?
               AND (? < end_time AND start_time < ?)`,
            [Number(doctor_id), shift_date, shiftId, sTime, eTime]
        );
        if (overlaps.length > 0) {
            return res.status(409).json({ success: false, message: 'Khung giờ sửa bị trùng với một ca trực khác của bác sĩ trong ngày!' });
        }

        await pool.execute(
            `UPDATE doctor_shifts
             SET doctor_id = ?, shift_date = ?, start_time = ?, end_time = ?, slot_duration = ?
             WHERE id = ?`,
            [Number(doctor_id), shift_date, sTime, eTime, Number(slot_duration) || 30, shiftId]
        );

        return res.json({ success: true, message: 'Cập nhật ca trực thành công.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi khi cập nhật ca trực.' });
    }
}

async function deleteShift(req, res) {
    try {
        const shiftId = Number(req.params.id);
        const [bookings] = await pool.execute(
            `SELECT COUNT(*) AS cnt FROM appointments WHERE shift_id = ? AND status IN ('pending', 'confirmed', 'completed')`,
            [shiftId]
        );
        if (bookings[0].cnt > 0) {
            return res.status(400).json({ success: false, message: 'Không thể xóa ca trực đã có bệnh nhân đặt lịch.' });
        }
        await pool.execute('DELETE FROM doctor_shifts WHERE id = ?', [shiftId]);
        return res.json({ success: true, message: 'Xóa ca trực thành công.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Không thể xóa ca trực (có thể đang được tham chiếu bởi lịch hẹn).' });
    }
}

async function getAllAppointmentsAdmin(req, res) {
    let connection;
    try {
        connection = await pool.getConnection();
        await expirePendingHolds(connection);
        const { date, specialty_id, status, search } = req.query;
        let query = `
            SELECT a.*, d.degree AS doctor_degree, d.room_number, u.full_name AS doctor_name,
                   s.name AS specialty_name,
                   email_event.status AS email_delivery_status,
                   email_event.event_type AS email_event_type
            FROM appointments a 
            JOIN doctors d ON a.doctor_id = d.id
            JOIN users u ON d.user_id = u.id 
            JOIN specialties s ON a.specialty_id = s.id 
            LEFT JOIN appointment_email_outbox email_event
                ON email_event.id = (
                    SELECT MAX(outbox.id)
                    FROM appointment_email_outbox outbox
                    WHERE outbox.appointment_id = a.id
                )
            WHERE 1=1
        `;
        const params = [];
        if (date) { query += ' AND a.appointment_date = ?'; params.push(date); }
        if (specialty_id && specialty_id !== 'all') { query += ' AND a.specialty_id = ?'; params.push(Number(specialty_id)); }
        if (status && status !== 'all') { query += ' AND a.status = ?'; params.push(status); }
        if (search && search.trim() !== '') {
            query += ' AND (a.appointment_code LIKE ? OR a.patient_name LIKE ? OR a.patient_phone LIKE ?)';
            const kw = `%${search.trim()}%`;
            params.push(kw, kw, kw);
        }
        query += ' ORDER BY a.appointment_date DESC, a.slot_time ASC';
        const [rows] = await connection.execute(query, params);
        const data = rows.map(r => ({
            ...r,
            doctor_display: formatDoctorDisplay(r.doctor_degree, r.doctor_name),
            room_number: r.room_number.replace(/^P\./, 'Phòng ').replace(' - ', ' – ')
        }));
        return res.json({ success: true, data });
    } catch (error) {
        console.error('Lỗi tải danh sách lịch hẹn:', error.message);
        return res.status(500).json({ success: false, message: 'Lỗi tải danh sách lịch hẹn.' });
    } finally {
        if (connection) connection.release();
    }
}

async function updateAppointmentStatusAdmin(req, res) {
    let connection;
    let transactionStarted = false;
    try {
        const id = Number(req.params.id);
        const { status, reason } = req.body || {};
        if (!Number.isInteger(id) || id < 1) {
            return res.status(400).json({ success: false, message: 'Mã lịch hẹn không hợp lệ.' });
        }
        if (!['confirmed', 'rejected', 'completed', 'cancelled'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Trạng thái lịch hẹn không hợp lệ.' });
        }
        const rejectionReason = String(reason || '').trim();
        if (status === 'rejected' && (!rejectionReason || rejectionReason.length > 255)) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập lý do từ chối (tối đa 255 ký tự).' });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();
        transactionStarted = true;

        const [initialRows] = await connection.execute(
            `SELECT a.id, a.doctor_id, a.status, a.appointment_date, a.slot_time, a.end_time,
                    a.hold_expires_at, d.room_number
             FROM appointments a JOIN doctors d ON d.id = a.doctor_id
             WHERE a.id = ? LIMIT 1`,
            [id]
        );
        if (!initialRows.length) {
            await connection.rollback();
            transactionStarted = false;
            return res.status(404).json({ success: false, message: 'Không tìm thấy lịch hẹn.' });
        }
        await lockAppointmentRoom(connection, initialRows[0].room_number);
        await expirePendingHolds(connection, id);
        const [[appointment]] = await connection.execute(
            `SELECT a.*, d.room_number, (a.hold_expires_at > NOW()) AS hold_active
             FROM appointments a JOIN doctors d ON d.id = a.doctor_id
             WHERE a.id = ? FOR UPDATE`,
            [id]
        );
        if (appointment.room_number !== initialRows[0].room_number) {
            await connection.rollback();
            transactionStarted = false;
            return res.status(409).json({ success: false, message: 'Phòng khám vừa thay đổi. Vui lòng tải lại yêu cầu trước khi xử lý.' });
        }
        if (appointment.status === 'expired') {
            await connection.commit();
            transactionStarted = false;
            return res.status(409).json({ success: false, status: 'expired', message: 'Yêu cầu đã hết thời hạn giữ chỗ và không thể duyệt.' });
        }
        if (appointment.status !== 'pending') {
            if (appointment.status === 'confirmed' && ['completed', 'cancelled'].includes(status)) {
                await connection.execute(
                    'UPDATE appointments SET status = ? WHERE id = ? AND status = ?',
                    [status, id, appointment.status]
                );
                await connection.commit();
                transactionStarted = false;
                return res.json({ success: true, message: status === 'completed' ? 'Đã đánh dấu lịch hẹn hoàn tất.' : 'Đã hủy lịch hẹn.' });
            }
            await connection.rollback();
            transactionStarted = false;
            return res.status(409).json({ success: false, message: 'Yêu cầu này đã được xử lý và không thể duyệt lại.' });
        }

        if (status === 'rejected') {
            await connection.execute(
                `UPDATE appointments
                 SET status = 'rejected', cancel_reason = ?, reviewed_by = ?, reviewed_at = NOW()
                 WHERE id = ? AND status = 'pending'`,
                [rejectionReason, req.user.id, id]
            );
            await enqueueAppointmentEmail(connection, id, 'rejected');
            await connection.commit();
            transactionStarted = false;
            return res.json({
                success: true,
                message: 'Đã từ chối yêu cầu và giải phóng khung giờ. Email thông báo đã được xếp hàng để gửi.',
                email_status: 'queued'
            });
        }
        if (status !== 'confirmed') {
            await connection.rollback();
            transactionStarted = false;
            return res.status(400).json({ success: false, message: 'Yêu cầu Chờ duyệt chỉ có thể được xác nhận hoặc từ chối.' });
        }

        if (Number(appointment.hold_active) !== 1) {
            await connection.execute(
                `UPDATE appointments
                 SET status = 'expired', cancel_reason = COALESCE(cancel_reason, 'Thời hạn giữ chỗ đã hết.')
                 WHERE id = ? AND status = 'pending'`,
                [id]
            );
            await connection.commit();
            transactionStarted = false;
            return res.status(409).json({ success: false, status: 'expired', message: 'Yêu cầu đã hết thời hạn giữ chỗ và không thể duyệt.' });
        }

        const schedule = await loadScheduleContext(
            connection,
            Number(appointment.doctor_id),
            String(appointment.appointment_date).slice(0, 10),
            String(appointment.appointment_date).slice(0, 10)
        );
        const intervals = getScheduleIntervals(schedule, String(appointment.appointment_date).slice(0, 10));
        const startMinutes = appointmentTimeToMinutes(appointment.slot_time);
        const endMinutes = appointmentTimeToMinutes(appointment.end_time);
        const scheduleStillValid = intervals.some(interval => {
            const intervalStart = appointmentTimeToMinutes(interval.start_time);
            const intervalEnd = appointmentTimeToMinutes(interval.end_time);
            const duration = Number(interval.slot_duration) || 30;
            return startMinutes >= intervalStart &&
                endMinutes <= intervalEnd &&
                (startMinutes - intervalStart) % duration === 0 &&
                endMinutes - startMinutes === duration;
        });
        const conflicts = scheduleStillValid ? await findScheduleConflict(connection, {
            appointmentId: id,
            doctorId: Number(appointment.doctor_id),
            roomNumber: appointment.room_number,
            appointmentDate: String(appointment.appointment_date).slice(0, 10),
            slotTime: appointment.slot_time,
            endTime: appointment.end_time
        }) : [{ id: null }];

        if (!scheduleStillValid || conflicts.length) {
            const failReason = scheduleStillValid
                ? 'Khung giờ bị xung đột với lịch hẹn khác khi duyệt.'
                : 'Khung giờ không còn nằm trong lịch làm việc của bác sĩ.';
            await connection.execute(
                `UPDATE appointments
                 SET status = 'rejected', cancel_reason = ?, reviewed_by = ?, reviewed_at = NOW()
                 WHERE id = ? AND status = 'pending'`,
                [failReason, req.user.id, id]
            );
            await enqueueAppointmentEmail(connection, id, 'rejected');
            await connection.commit();
            transactionStarted = false;
            return res.status(409).json({
                success: false,
                status: 'rejected',
                email_status: 'queued',
                message: `${failReason} Yêu cầu đã bị từ chối và khung giờ được giải phóng; email thông báo đã được xếp hàng.`
            });
        }

        const [updated] = await connection.execute(
            `UPDATE appointments
             SET status = 'confirmed', reviewed_by = ?, reviewed_at = NOW()
             WHERE id = ? AND status = 'pending' AND hold_expires_at > NOW()`,
            [req.user.id, id]
        );
        if (!updated.affectedRows) {
            await expirePendingHolds(connection, id);
            await connection.commit();
            transactionStarted = false;
            return res.status(409).json({ success: false, status: 'expired', message: 'Thời hạn giữ chỗ đã hết trước khi xác nhận.' });
        }
        await enqueueAppointmentEmail(connection, id, 'confirmed');
        await connection.commit();
        transactionStarted = false;
        return res.json({
            success: true,
            message: 'Đã xác nhận lịch hẹn. Email thông báo đã được xếp hàng để gửi.',
            email_status: 'queued'
        });
    } catch (error) {
        if (connection && transactionStarted) await connection.rollback();
        console.error('Lỗi cập nhật trạng thái lịch hẹn:', error.message);
        return res.status(500).json({ success: false, message: 'Lỗi cập nhật trạng thái lịch hẹn.' });
    } finally {
        if (connection) connection.release();
    }
}

function appointmentTimeToMinutes(value) {
    const [hours, minutes] = String(value).split(':').map(Number);
    return hours * 60 + minutes;
}

async function getUsersAdmin(req, res) {
    try {
        const [users] = await pool.execute(
            'SELECT id, email, full_name, role, is_active, created_at FROM users ORDER BY id ASC'
        );
        const [patients] = await pool.execute(
            'SELECT id, full_name, phone, email, gender, date_of_birth, created_at FROM patients ORDER BY id DESC LIMIT 100'
        );
        return res.json({ success: true, data: { users, patients } });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi tải danh sách người dùng.' });
    }
}

module.exports = {
    getDashboardStats, getAllSpecialtiesAdmin, createSpecialty, updateSpecialty,
    getAllDoctorsAdmin, createDoctor, toggleDoctorActive, getShiftsAdmin, createShift,
    updateShift, deleteShift, getAllAppointmentsAdmin, updateAppointmentStatusAdmin, getUsersAdmin
};