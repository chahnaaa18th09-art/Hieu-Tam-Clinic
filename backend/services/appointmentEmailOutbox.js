const { sendAppointmentEmail } = require('./emailService');

const EMAIL_EVENTS = new Set(['received', 'confirmed', 'rejected']);
const LEASE_SECONDS = 120;
const MAX_RETRY_SECONDS = 6 * 60 * 60;

async function enqueueAppointmentEmail(connection, appointmentId, eventType) {
    if (!EMAIL_EVENTS.has(eventType)) {
        throw new Error(`Unsupported appointment email event: ${eventType}`);
    }

    const [rows] = await connection.execute(
        `SELECT a.id, a.appointment_code, a.patient_name, a.patient_email,
                a.appointment_date, a.slot_time, a.end_time, a.status,
                a.cancel_reason, a.schedule_source,
                d.degree AS doctor_degree, u.full_name AS doctor_name,
                s.name AS specialty_name, d.room_number
         FROM appointments a
         JOIN doctors d ON d.id = a.doctor_id
         JOIN users u ON u.id = d.user_id
         JOIN specialties s ON s.id = a.specialty_id
         WHERE a.id = ? LIMIT 1`,
        [appointmentId]
    );
    if (!rows.length) {
        throw new Error(`Cannot queue email for missing appointment ${appointmentId}.`);
    }

    const appointment = rows[0];
    const payload = JSON.stringify({
        ...appointment,
        appointment_date: String(appointment.appointment_date).slice(0, 10),
        room_number: appointment.room_number.replace(/^P\./, 'Phòng ').replace(' - ', ' – ')
    });
    await connection.execute(
        `INSERT IGNORE INTO appointment_email_outbox
            (appointment_id, event_type, recipient, payload, status, next_attempt_at)
         VALUES (?, ?, ?, ?, 'queued', NOW())`,
        [appointmentId, eventType, appointment.patient_email, payload]
    );
}

async function claimNextEmail(pool) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
            `SELECT id, appointment_id, event_type, payload, attempt_count
             FROM appointment_email_outbox
             WHERE (status IN ('queued', 'retry') AND next_attempt_at <= NOW())
                OR (status = 'sending' AND lease_until <= NOW())
             ORDER BY next_attempt_at ASC, id ASC
             LIMIT 1 FOR UPDATE`
        );
        if (!rows.length) {
            await connection.commit();
            return null;
        }

        const item = rows[0];
        await connection.execute(
            `UPDATE appointment_email_outbox
             SET status = 'sending',
                 attempt_count = attempt_count + 1,
                 lease_until = DATE_ADD(NOW(), INTERVAL ${LEASE_SECONDS} SECOND),
                 updated_at = NOW()
             WHERE id = ?`,
            [item.id]
        );
        await connection.commit();
        return { ...item, attempt_count: Number(item.attempt_count) + 1 };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

function retryDelaySeconds(attemptCount, error) {
    if (error.code === 'SMTP_NOT_CONFIGURED') return 60 * 60;
    return Math.min(30 * (2 ** Math.min(attemptCount - 1, 10)), MAX_RETRY_SECONDS);
}

async function processNextEmail(pool) {
    const item = await claimNextEmail(pool);
    if (!item) return false;

    try {
        const payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;
        await sendAppointmentEmail(item.event_type, payload, item.id);
        await pool.execute(
            `UPDATE appointment_email_outbox
             SET status = 'sent', sent_at = NOW(), lease_until = NULL,
                 last_error = NULL, updated_at = NOW()
             WHERE id = ? AND status = 'sending'`,
            [item.id]
        );
    } catch (error) {
        const delaySeconds = retryDelaySeconds(item.attempt_count, error);
        await pool.execute(
            `UPDATE appointment_email_outbox
             SET status = 'retry',
                 next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
                 lease_until = NULL,
                 last_error = ?,
                 updated_at = NOW()
             WHERE id = ? AND status = 'sending'`,
            [delaySeconds, String(error.message || 'Email delivery failed').slice(0, 1000), item.id]
        );
        console.error(
            `[Email outbox] Không gửi được sự kiện ${item.event_type} cho lịch #${item.appointment_id}; thử lại sau ${delaySeconds}s:`,
            error.message
        );
    }
    return true;
}

async function processPendingEmails(pool, limit = 10) {
    for (let index = 0; index < limit; index += 1) {
        if (!await processNextEmail(pool)) break;
    }
}

module.exports = { enqueueAppointmentEmail, processPendingEmails };
