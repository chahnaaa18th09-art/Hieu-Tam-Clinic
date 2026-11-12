USE hieu_tam_clinic;

CREATE TABLE IF NOT EXISTS doctor_weekly_schedules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    weekday TINYINT UNSIGNED NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    slot_duration INT NOT NULL DEFAULT 30,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_demo TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_weekly_schedule_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    CONSTRAINT chk_weekly_schedule_weekday CHECK (weekday BETWEEN 0 AND 6),
    CONSTRAINT chk_weekly_schedule_time CHECK (end_time > start_time),
    UNIQUE KEY uq_weekly_schedule_interval (doctor_id, weekday, start_time, end_time),
    INDEX idx_weekly_schedule_lookup (doctor_id, is_active, weekday)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS doctor_schedule_exceptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    exception_date DATE NOT NULL,
    is_closed TINYINT(1) NOT NULL DEFAULT 1,
    start_time TIME NULL,
    end_time TIME NULL,
    slot_duration INT NULL,
    note VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_schedule_exception_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    CONSTRAINT chk_schedule_exception_time CHECK (
        is_closed = 1 OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
    ),
    UNIQUE KEY uq_schedule_exception_date (doctor_id, exception_date),
    INDEX idx_schedule_exception_lookup (doctor_id, exception_date)
) ENGINE=InnoDB;

-- Demo schedules only fill doctors that match the existing sample profiles and have no schedule yet.
INSERT INTO doctor_weekly_schedules (doctor_id, weekday, start_time, end_time, slot_duration, is_demo)
SELECT d.id, weekday_values.weekday, time_values.start_time, time_values.end_time, 30, 1
FROM doctors d
JOIN users u ON u.id = d.user_id
CROSS JOIN (
    SELECT 0 AS weekday UNION ALL SELECT 1 UNION ALL SELECT 2
    UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
) AS weekday_values
CROSS JOIN (
    SELECT '08:00:00' AS start_time, '11:30:00' AS end_time
    UNION ALL SELECT '13:30:00', '17:00:00'
) AS time_values
WHERE u.full_name IN (
    'Nguyễn Minh Triết', 'Lê Thanh Hà', 'Vũ Phương Thảo', 'Trần Hoàng Nam',
    'Đặng Quốc Huy', 'Phạm Thùy Linh', 'Hoàng Minh Tuấn', 'Nguyễn Ngọc Mai'
)
  AND (
      (u.full_name = 'Nguyễn Minh Triết' AND d.specialty_id = 1)
      OR (u.full_name = 'Lê Thanh Hà' AND d.specialty_id = 2)
      OR (u.full_name = 'Vũ Phương Thảo' AND d.specialty_id = 6)
      OR (u.full_name = 'Trần Hoàng Nam' AND d.specialty_id = 5)
      OR (u.full_name = 'Đặng Quốc Huy' AND d.specialty_id = 4)
      OR (u.full_name = 'Phạm Thùy Linh' AND d.specialty_id = 3)
      OR (u.full_name = 'Hoàng Minh Tuấn' AND d.specialty_id = 7)
      OR (u.full_name = 'Nguyễn Ngọc Mai' AND d.specialty_id = 8)
  )
  AND (weekday_values.weekday < 5 OR time_values.start_time = '08:00:00')
  AND NOT EXISTS (
      SELECT 1 FROM doctor_weekly_schedules existing
      WHERE existing.doctor_id = d.id
  );
