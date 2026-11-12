const DEFAULT_WEEKLY_SCHEDULES = Array.from({ length: 6 }, (_, weekday) => [
    { weekday, start_time: '07:30:00', end_time: '11:30:00', slot_duration: 30, is_demo: 0 },
    { weekday, start_time: '13:30:00', end_time: '17:00:00', slot_duration: 30, is_demo: 0 }
]).flat();

function isDateString(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(dateString, days) {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function listDates(startDate, endDate) {
    const dates = [];
    for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
        dates.push(date);
    }
    return dates;
}

async function getBookingWindow(connection) {
    const [[row]] = await connection.execute('SELECT CURDATE() AS today');
    const startDate = String(row.today).slice(0, 10);
    if (!isDateString(startDate)) {
        throw new Error('Database returned an invalid clinic date.');
    }
    return {
        startDate,
        endDate: `${Number(startDate.slice(0, 4)) + 1}-12-31`
    };
}

async function loadScheduleContext(connection, doctorId, startDate, endDate) {
    const [[doctor]] = await connection.execute(
        `SELECT d.id
         FROM doctors d JOIN users u ON u.id = d.user_id
         WHERE d.id = ? AND d.is_active = 1 AND u.is_active = 1
         LIMIT 1`,
        [doctorId]
    );
    if (!doctor) return null;

    const [weeklySchedules] = await connection.execute(
        `SELECT weekday, start_time, end_time, slot_duration, is_demo
         FROM doctor_weekly_schedules
         WHERE doctor_id = ? AND is_active = 1
         ORDER BY weekday ASC, start_time ASC`,
        [doctorId]
    );
    const [exceptions] = await connection.execute(
        `SELECT exception_date, is_closed, start_time, end_time, slot_duration
         FROM doctor_schedule_exceptions
         WHERE doctor_id = ? AND exception_date BETWEEN ? AND ?`,
        [doctorId, startDate, endDate]
    );
    const [datedShifts] = await connection.execute(
        `SELECT id, shift_date, start_time, end_time, slot_duration, status, is_demo
         FROM doctor_shifts
         WHERE doctor_id = ? AND shift_date BETWEEN ? AND ?
         ORDER BY shift_date ASC, start_time ASC`,
        [doctorId, startDate, endDate]
    );

    return { weeklySchedules, exceptions, datedShifts };
}

function getScheduleIntervals(context, date) {
    if (!context) return [];

    const weekday = (new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7;
    if (weekday === 6) return [];

    const exception = context.exceptions.find(row => String(row.exception_date).slice(0, 10) === date);
    if (exception) {
        if (Number(exception.is_closed) === 1) return [];
        return [{
            id: null,
            start_time: exception.start_time,
            end_time: exception.end_time,
            slot_duration: exception.slot_duration,
            is_demo: 0
        }];
    }

    const dateShifts = context.datedShifts.filter(row => String(row.shift_date).slice(0, 10) === date);
    if (dateShifts.length) {
        return dateShifts
            .filter(row => row.status === 'active')
            .map(row => ({ ...row, is_demo: Number(row.is_demo) }));
    }

    const weeklySchedules = context.weeklySchedules.length
        ? context.weeklySchedules
        : DEFAULT_WEEKLY_SCHEDULES;
    return weeklySchedules
        .filter(row => Number(row.weekday) === weekday)
        .map(row => ({ ...row, id: null }));
}

module.exports = {
    addDays,
    getBookingWindow,
    getScheduleIntervals,
    isDateString,
    listDates,
    loadScheduleContext
};
