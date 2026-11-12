const configuredHoldMinutes = process.env.APPOINTMENT_HOLD_MINUTES || '60';
const HOLD_MINUTES = Number(configuredHoldMinutes);

if (!Number.isInteger(HOLD_MINUTES) || HOLD_MINUTES < 1) {
    throw new Error('APPOINTMENT_HOLD_MINUTES must be a positive integer.');
}

async function expirePendingHolds(connection, appointmentId = null) {
    const params = [];
    let query = `
        UPDATE appointments
        SET status = 'expired',
            cancel_reason = COALESCE(cancel_reason, 'Thời hạn giữ chỗ đã hết.')
        WHERE status = 'pending'
          AND hold_expires_at IS NOT NULL
          AND hold_expires_at <= NOW()
    `;
    if (appointmentId !== null) {
        query += ' AND id = ?';
        params.push(appointmentId);
    }
    const [result] = await connection.execute(query, params);
    return result.affectedRows;
}

async function expirePendingHoldsFromPool(pool) {
    const [result] = await pool.execute(`
        UPDATE appointments
        SET status = 'expired',
            cancel_reason = COALESCE(cancel_reason, 'Thời hạn giữ chỗ đã hết.')
        WHERE status = 'pending'
          AND hold_expires_at IS NOT NULL
          AND hold_expires_at <= NOW()
    `);
    return result.affectedRows;
}

async function lockAppointmentRoom(connection, roomNumber) {
    const [rows] = await connection.execute(
        'SELECT id FROM doctors WHERE room_number = ? ORDER BY id FOR UPDATE',
        [roomNumber]
    );
    return rows;
}

async function findScheduleConflict(connection, {
    appointmentId = null,
    doctorId,
    roomNumber,
    appointmentDate,
    slotTime,
    endTime
}) {
    const params = [appointmentDate, doctorId, roomNumber, endTime, slotTime];
    let excludedAppointment = '';
    if (appointmentId !== null) {
        excludedAppointment = ' AND a.id <> ?';
        params.push(appointmentId);
    }

    const [rows] = await connection.execute(
        `SELECT a.id, a.doctor_id, a.slot_time, a.end_time, a.status
         FROM appointments a
         JOIN doctors d ON d.id = a.doctor_id
         WHERE a.appointment_date = ?
           AND (a.doctor_id = ? OR d.room_number = ?)
           AND (a.status IN ('confirmed', 'completed')
                OR (a.status = 'pending' AND a.hold_expires_at > NOW()))
           AND a.slot_time < ?
           AND a.end_time > ?
           ${excludedAppointment}
         FOR UPDATE`,
        params
    );
    return rows;
}

module.exports = {
    HOLD_MINUTES,
    expirePendingHolds,
    expirePendingHoldsFromPool,
    findScheduleConflict,
    lockAppointmentRoom
};
