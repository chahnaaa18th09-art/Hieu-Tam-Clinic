USE hieu_tam_clinic;

ALTER TABLE doctor_shifts
    ADD COLUMN is_demo TINYINT(1) NOT NULL DEFAULT 0 AFTER status;

UPDATE doctor_shifts shift
JOIN doctor_weekly_schedules schedule
    ON schedule.doctor_id = shift.doctor_id
   AND schedule.weekday = WEEKDAY(shift.shift_date)
   AND schedule.start_time = shift.start_time
   AND schedule.end_time = shift.end_time
   AND schedule.slot_duration = shift.slot_duration
   AND schedule.is_demo = 1
   AND shift.created_at >= schedule.created_at
SET shift.is_demo = 1;
