const { pool } = require('../config/db');

async function getDoctorDashboard(req, res) {
    try {
        const doctorId = req.user.doctor_id;
        const [profile] = await pool.execute(
            `SELECT d.*, u.full_name, u.email, s.name AS specialty_name
             FROM doctors d 
             JOIN users u ON d.user_id = u.id 
             JOIN specialties s ON d.specialty_id = s.id
             WHERE d.id = ? LIMIT 1`,
            [doctorId]
        );

        const [stats] = await pool.execute(
            `SELECT
                COUNT(*) AS total_appointments,
                SUM(CASE WHEN appointment_date = CURDATE() THEN 1 ELSE 0 END) AS today_total,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
                SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed_count,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count
             FROM appointments WHERE doctor_id = ?`,
            [doctorId]
        );

        const [shifts] = await pool.execute(
            `SELECT * FROM doctor_shifts WHERE doctor_id = ? AND shift_date >= CURDATE() AND status = 'active'
             ORDER BY shift_date ASC, start_time ASC LIMIT 14`,
            [doctorId]
        );

        return res.json({
            success: true,
            data: { profile: profile[0], stats: stats[0], upcoming_shifts: shifts }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi khi tải thông tin bác sĩ.' });
    }
}

async function getDoctorAppointments(req, res) {
    try {
        const doctorId = req.user.doctor_id;
        const { date, status, search } = req.query;

        let query = `
            SELECT a.*, s.name AS specialty_name
            FROM appointments a 
            JOIN specialties s ON a.specialty_id = s.id
            WHERE a.doctor_id = ?
        `;
        const params = [doctorId];

        if (date) { query += ' AND a.appointment_date = ?'; params.push(date); }
        if (status && status !== 'all') { query += ' AND a.status = ?'; params.push(status); }
        if (search && search.trim() !== '') {
            query += ' AND (a.appointment_code LIKE ? OR a.patient_name LIKE ? OR a.patient_phone LIKE ?)';
            const kw = `%${search.trim()}%`;
            params.push(kw, kw, kw);
        }

        query += ' ORDER BY a.appointment_date DESC, a.slot_time ASC';
        const [rows] = await pool.execute(query, params);
        return res.json({ success: true, data: rows });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi tải danh sách lịch hẹn.' });
    }
}

async function updateDoctorAppointmentStatus(req, res) {
    try {
        const doctorId = req.user.doctor_id;
        const apptId = Number(req.params.id);
        const { status, doctor_notes } = req.body;

        const allowedStatuses = ['completed', 'cancelled'];
        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: 'Trạng thái lịch hẹn không hợp lệ.' });
        }

        const [result] = await pool.execute(
            `UPDATE appointments
             SET status = ?, doctor_notes = COALESCE(?, doctor_notes)
             WHERE id = ? AND doctor_id = ? AND status = 'confirmed'`,
            [status, doctor_notes || null, apptId, doctorId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy lịch hẹn hoặc không có quyền cập nhật.' });
        }

        return res.json({ success: true, message: 'Cập nhật trạng thái lịch hẹn thành công.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi cập nhật lịch hẹn.' });
    }
}

module.exports = { getDoctorDashboard, getDoctorAppointments, updateDoctorAppointmentStatus };