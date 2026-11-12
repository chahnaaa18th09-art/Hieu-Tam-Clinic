const nodemailer = require('nodemailer');

const CLINIC_ADDRESS = process.env.CLINIC_ADDRESS || 'Số 126 Nguyễn Thiện Thành, Phường 5, TP. Trà Vinh (Phòng khám Đa khoa Hiếu Tâm)';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDoctorDisplay(degree, fullName) {
    const cleanName = String(fullName || '').replace(/^(BS\.CKII|BS\.CKI|ThS\.BS|TS\.BS|PGS\.TS|BS)\s+/i, '').trim();
    const mapDegree = {
        'Bác sĩ Chuyên khoa II': 'BS.CKII',
        'Bác sĩ Chuyên khoa I': 'BS.CKI',
        'Thạc sĩ Bác sĩ': 'ThS.BS',
        'Tiến sĩ Bác sĩ': 'TS.BS',
        'Bác sĩ CKI': 'BS.CKI',
        'Bác sĩ CKII': 'BS.CKII'
    };
    return `${mapDegree[degree] || degree || 'BS.'} ${cleanName}`.trim();
}

function createTransporter() {
    if (!process.env.SMTP_USER?.trim() || !process.env.SMTP_PASS?.trim()) {
        const error = new Error('SMTP_USER và SMTP_PASS chưa được cấu hình.');
        error.code = 'SMTP_NOT_CONFIGURED';
        throw error;
    }

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER.trim(),
            pass: process.env.SMTP_PASS.trim()
        },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000
    });
}

function formatClinicDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    if (!match) return String(value || '');
    return `${match[3]}/${match[2]}/${match[1]}`;
}

function emailContent(eventType, appointment) {
    const doctor = formatDoctorDisplay(appointment.doctor_degree, appointment.doctor_name);
    const appointmentDate = formatClinicDate(appointment.appointment_date);
    const time = `${String(appointment.slot_time).slice(0, 5)}–${String(appointment.end_time).slice(0, 5)}`;
    const demoNote = appointment.schedule_source === 'demo'
        ? '<p style="padding:12px;background:#fff7ed;border-left:4px solid #c2410c;color:#7c2d12;"><strong>Lưu ý:</strong> Đây là lịch DEMO, chỉ dùng minh họa và không phải lịch thật đã được phòng khám xác nhận.</p>'
        : '';
    const summary = `
        <p><strong>Mã yêu cầu:</strong> ${escapeHtml(appointment.appointment_code)}</p>
        <p><strong>Bác sĩ:</strong> ${escapeHtml(doctor)}</p>
        <p><strong>Chuyên khoa:</strong> ${escapeHtml(appointment.specialty_name)}</p>
        <p><strong>Ngày, giờ:</strong> ${escapeHtml(appointmentDate)} · ${escapeHtml(time)}</p>
        <p><strong>Phòng khám:</strong> ${escapeHtml(appointment.room_number)}</p>
        <p><strong>Địa chỉ:</strong> ${escapeHtml(CLINIC_ADDRESS)}</p>
    `;

    if (eventType === 'received') {
        const message = 'Hệ thống đã nhận yêu cầu đặt lịch của bạn. Lịch hẹn đang chờ xác nhận và chưa phải lịch khám chính thức.';
        return {
            subject: `[Hiếu Tâm] Đã tiếp nhận yêu cầu #${appointment.appointment_code}`,
            text: `Xin chào ${appointment.patient_name},\n\n${message}\n\n${appointment.appointment_code} · ${doctor} · ${appointmentDate} ${time} · ${appointment.room_number}\n${appointment.schedule_source === 'demo' ? 'LƯU Ý: Đây là lịch DEMO, không phải lịch thật của phòng khám.\n' : ''}`,
            heading: 'Đã tiếp nhận yêu cầu đặt lịch',
            message,
            summary,
            demoNote,
            status: 'CHỜ DUYỆT'
        };
    }

    if (eventType === 'confirmed') {
        const message = 'Lịch hẹn của bạn đã được phòng khám xác nhận.';
        return {
            subject: `[Hiếu Tâm] Lịch hẹn #${appointment.appointment_code} đã được xác nhận`,
            text: `Xin chào ${appointment.patient_name},\n\n${message}\n${appointment.appointment_code} · ${doctor} · ${appointment.specialty_name} · ${appointmentDate} ${time} · ${appointment.room_number}\n${appointment.schedule_source === 'demo' ? 'LƯU Ý: Đây là lịch DEMO, không phải lịch thật của phòng khám.\n' : ''}`,
            heading: 'Lịch hẹn đã được xác nhận',
            message,
            summary,
            demoNote,
            status: 'ĐÃ XÁC NHẬN'
        };
    }

    const rejectionReason = appointment.cancel_reason || 'Khung giờ không còn khả dụng.';
    const message = `Yêu cầu đặt lịch của bạn đã bị từ chối. Lý do: ${rejectionReason} Vui lòng chọn một khung giờ khác.`;
    return {
        subject: `[Hiếu Tâm] Cập nhật yêu cầu đặt lịch #${appointment.appointment_code}`,
        text: `Xin chào ${appointment.patient_name},\n\n${message}\n\nMã yêu cầu: ${appointment.appointment_code}`,
        heading: 'Yêu cầu đặt lịch bị từ chối',
        message,
        summary: `<p><strong>Mã yêu cầu:</strong> ${escapeHtml(appointment.appointment_code)}</p><p><strong>Lý do:</strong> ${escapeHtml(rejectionReason)}</p>`,
        demoNote: '',
        status: 'BỊ TỪ CHỐI'
    };
}

async function sendAppointmentEmail(eventType, appointment, outboxId) {
    const transporter = createTransporter();
    const content = emailContent(eventType, appointment);
    const from = process.env.SMTP_FROM || `"Phòng khám Đa khoa Hiếu Tâm" <${process.env.SMTP_USER}>`;
    const messageId = `<appointment-${appointment.id}-${eventType}-${outboxId}@hieutam.vn>`;
    await transporter.sendMail({
        from,
        to: appointment.patient_email,
        subject: content.subject,
        messageId,
        text: content.text,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #d8ebe3;border-radius:12px;overflow:hidden;color:#1e293b;">
                <div style="background:#103329;color:#fff;padding:22px;text-align:center;">
                    <h2 style="margin:0;">PHÒNG KHÁM ĐA KHOA HIẾU TÂM</h2>
                    <p style="margin:8px 0 0;">${escapeHtml(content.heading)}</p>
                </div>
                <div style="padding:24px;background:#fff;">
                    <p>Xin chào <strong>${escapeHtml(appointment.patient_name)}</strong>,</p>
                    <p>${escapeHtml(content.message)}</p>
                    <div style="padding:16px;margin:18px 0;background:#f2faf6;border-left:4px solid #136f52;border-radius:6px;">
                        ${content.summary}
                        <p><strong>Trạng thái:</strong> ${escapeHtml(content.status)}</p>
                    </div>
                    ${content.demoNote}
                </div>
            </div>
        `
    });
}

module.exports = { formatDoctorDisplay, sendAppointmentEmail };
