DROP DATABASE IF EXISTS hieu_tam_clinic;
CREATE DATABASE hieu_tam_clinic CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hieu_tam_clinic;

-- 1. Bảng users: Tài khoản đăng nhập (Admin & Bác sĩ)
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role ENUM('admin', 'doctor') NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_users_role_active (role, is_active)
) ENGINE=InnoDB;

-- 2. Bảng specialties: Danh mục 8 chuyên khoa chuẩn theo hình mẫu
CREATE TABLE specialties (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE,
    code VARCHAR(30) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    icon_name VARCHAR(50) DEFAULT 'STETHOSCOPE',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 3. Bảng doctors: Thông tin hồ sơ bác sĩ
CREATE TABLE doctors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    specialty_id INT NOT NULL,
    degree VARCHAR(80) NOT NULL DEFAULT 'BS.CKI',
    phone VARCHAR(20) NOT NULL,
    bio TEXT,
    room_number VARCHAR(50) NOT NULL DEFAULT 'Phòng 101 – Tầng 1',
    experience_years INT NOT NULL DEFAULT 5,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_doctor_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_doctor_specialty FOREIGN KEY (specialty_id) REFERENCES specialties(id) ON DELETE RESTRICT,
    INDEX idx_doctor_specialty (specialty_id, is_active)
) ENGINE=InnoDB;

-- 4. Bảng patients: Hồ sơ bệnh nhân
CREATE TABLE patients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(120) NOT NULL,
    date_of_birth DATE NULL,
    gender ENUM('Nam', 'Nữ', 'Khác') DEFAULT 'Nam',
    address VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_patient_phone (phone),
    INDEX idx_patient_email (email)
) ENGINE=InnoDB;

-- 5. Bảng doctor_shifts: Ca trực của bác sĩ
CREATE TABLE doctor_shifts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    shift_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    slot_duration INT NOT NULL DEFAULT 30,
    status ENUM('active', 'cancelled') NOT NULL DEFAULT 'active',
    is_demo TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_shift_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    CONSTRAINT chk_shift_time CHECK (end_time > start_time),
    INDEX idx_shift_lookup (doctor_id, shift_date, status)
) ENGINE=InnoDB;

-- Lịch tuần lặp lại; is_demo phân biệt dữ liệu minh họa với lịch phòng khám đã xác nhận.
CREATE TABLE doctor_weekly_schedules (
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

-- Ngoại lệ có thể đóng toàn bộ ngày hoặc thay ca định kỳ bằng một khung giờ riêng.
CREATE TABLE doctor_schedule_exceptions (
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

-- 6. Bảng appointments: Lịch hẹn khám bệnh
CREATE TABLE appointments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    appointment_code VARCHAR(25) NOT NULL UNIQUE,
    patient_id INT NOT NULL,
    doctor_id INT NOT NULL,
    specialty_id INT NOT NULL,
    shift_id INT NOT NULL,
    appointment_date DATE NOT NULL,
    slot_time TIME NOT NULL,
    end_time TIME NOT NULL,
    patient_name VARCHAR(100) NOT NULL,
    patient_phone VARCHAR(20) NOT NULL,
    patient_email VARCHAR(120) NOT NULL,
    patient_dob DATE NULL,
    patient_gender ENUM('Nam', 'Nữ', 'Khác') DEFAULT 'Nam',
    reason TEXT NOT NULL,
    status ENUM('pending', 'confirmed', 'completed', 'cancelled', 'rejected', 'expired') NOT NULL DEFAULT 'pending',
    hold_expires_at DATETIME NULL,
    schedule_source ENUM('clinic', 'demo') NOT NULL DEFAULT 'clinic',
    idempotency_key VARCHAR(64) NULL,
    request_fingerprint CHAR(64) NULL,
    reviewed_by INT NULL,
    reviewed_at DATETIME NULL,
    doctor_notes TEXT NULL,
    cancel_reason VARCHAR(255) NULL,
    active_slot_lock VARCHAR(60) GENERATED ALWAYS AS (
        CASE WHEN status IN ('pending', 'confirmed', 'completed')
        THEN CONCAT(doctor_id, '_', appointment_date, '_', slot_time)
        ELSE NULL END
    ) STORED,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_appt_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
    CONSTRAINT fk_appt_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE RESTRICT,
    CONSTRAINT fk_appt_specialty FOREIGN KEY (specialty_id) REFERENCES specialties(id) ON DELETE RESTRICT,
    CONSTRAINT fk_appt_shift FOREIGN KEY (shift_id) REFERENCES doctor_shifts(id) ON DELETE RESTRICT,
    CONSTRAINT fk_appointment_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE KEY uq_active_doctor_slot (active_slot_lock),
    UNIQUE KEY uq_appointment_idempotency (idempotency_key),
    INDEX idx_appt_date_status (appointment_date, status),
    INDEX idx_appt_doctor_date (doctor_id, appointment_date),
    INDEX idx_appointment_hold_expiry (status, hold_expires_at),
    INDEX idx_appt_lookup_verify (appointment_code, patient_phone)
) ENGINE=InnoDB;

CREATE TABLE appointment_email_outbox (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    appointment_id INT NOT NULL,
    event_type ENUM('received', 'confirmed', 'rejected') NOT NULL,
    recipient VARCHAR(120) NOT NULL,
    payload JSON NOT NULL,
    status ENUM('queued', 'sending', 'retry', 'sent') NOT NULL DEFAULT 'queued',
    attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
    next_attempt_at DATETIME NOT NULL,
    lease_until DATETIME NULL,
    last_error VARCHAR(1000) NULL,
    sent_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_appointment_email_appointment
        FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
    UNIQUE KEY uq_appointment_email_event (appointment_id, event_type),
    INDEX idx_appointment_email_delivery (status, next_attempt_at, lease_until)
) ENGINE=InnoDB;

-- 7. Bảng contact_messages: Lưu tin nhắn từ trang Liên hệ
CREATE TABLE contact_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(120) NULL,
    subject VARCHAR(150) NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- DỮ LIỆU MẪU KIỂM THỬ (Mật khẩu mặc định: 123456)
INSERT INTO users (id, email, password_hash, full_name, role, is_active) VALUES
(1, 'admin@hieutam.vn', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'Quản Trị Viên Hiếu Tâm', 'admin', 1),
(2, 'bs.minhtriet@hieutam.vn', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'Nguyễn Minh Triết', 'doctor', 1),
(3, 'bs.thanhha@hieutam.vn', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'Lê Thanh Hà', 'doctor', 1),
(4, 'bs.hoangnam@hieutam.vn', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'Trần Hoàng Nam', 'doctor', 1),
(5, 'bs.phuongthao@hieutam.vn', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'Vũ Phương Thảo', 'doctor', 1),
(6, 'bs.quochuy@hieutam.vn', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'Đặng Quốc Huy', 'doctor', 1),
(7, 'bs.thuylinh@hieutam.vn', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'Phạm Thùy Linh', 'doctor', 1),
(8, 'bs.minhtuan@hieutam.vn', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'Hoàng Minh Tuấn', 'doctor', 1),
(9, 'bs.ngocmai@hieutam.vn', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'Nguyễn Ngọc Mai', 'doctor', 1);

INSERT INTO specialties (id, name, code, description, icon_name, is_active) VALUES
(1, 'Nội Tổng Quát', 'NOI-TQ', 'Khám, chẩn đoán và điều trị các bệnh lý nội khoa tổng quát, tim mạch, hô hấp, tiêu hóa...', 'STETHOSCOPE', 1),
(2, 'Tim Mạch', 'TIM-MACH', 'Chẩn đoán chuyên sâu bệnh lý tim mạch, huyết áp, rối loạn nhịp tim, suy tim...', 'HEART', 1),
(3, 'Nhi Khoa', 'NHI-KHOA', 'Tư vấn dinh dưỡng, khám bệnh lý và điều trị các bệnh lý ở trẻ em từ sơ sinh đến tuổi dậy thì.', 'BABY', 1),
(4, 'Tai Mũi Họng', 'TMH', 'Khám và điều trị các bệnh lý về tai, mũi, họng, viêm tai giữa, viêm xoang...', 'EAR', 1),
(5, 'Da Liễu', 'DA-LIEU', 'Khám và điều trị các bệnh lý về da, mụn, nám, chàm, vảy nến, dị ứng...', 'SHIELD', 1),
(6, 'Sản Phụ Khoa', 'SAN-PK', 'Chăm sóc sức khỏe sinh sản, thai kỳ, kế hoạch hóa gia đình.', 'BABY', 1),
(7, 'Cơ Xương Khớp', 'CXK', 'Khám và điều trị các bệnh lý cơ xương khớp.', 'BONE', 1),
(8, 'Mắt', 'MAT', 'Khám và điều trị các bệnh lý về mắt.', 'EYE', 1);

INSERT INTO doctors (id, user_id, specialty_id, degree, phone, bio, room_number, experience_years, is_active) VALUES
(1, 2, 1, 'BS.CKII', '0901234501', 'Thăm khám, tư vấn và theo dõi các vấn đề sức khỏe nội khoa thường gặp.', 'Phòng 101 – Tầng 1', 15, 1),
(2, 3, 2, 'ThS.BS', '0901234502', 'Tư vấn, thăm khám và theo dõi sức khỏe tim mạch.', 'Phòng 201 – Tầng 2', 10, 1),
(3, 4, 5, 'BS.CKI', '0901234504', 'Thăm khám và tư vấn chăm sóc các vấn đề da liễu thường gặp.', 'Phòng 301 – Tầng 3', 8, 1),
(4, 5, 6, 'ThS.BS', '0901234503', 'Tư vấn sức khỏe phụ nữ và chăm sóc sức khỏe thai kỳ.', 'Phòng 102 – Tầng 1', 12, 1),
(5, 6, 4, 'BS.CKI', '0901234505', 'Thăm khám và tư vấn các vấn đề tai, mũi, họng.', 'Phòng 202 – Tầng 2', 9, 1),
(6, 7, 3, 'BS.CKI', '0901234506', 'Thăm khám và tư vấn chăm sóc sức khỏe trẻ em.', 'Phòng 203 – Tầng 2', 7, 1),
(7, 8, 7, 'BS.CKII', '0901234507', 'Thăm khám và tư vấn các vấn đề cơ, xương và khớp.', 'Phòng 302 – Tầng 3', 8, 1),
(8, 9, 8, 'BS.CKI', '0901234508', 'Thăm khám và tư vấn chăm sóc sức khỏe đôi mắt.', 'Phòng 204 – Tầng 2', 6, 1);

-- LỊCH DEMO cho 8 bác sĩ: thứ Hai–Bảy, sáng 08:00–11:30; thứ Hai–Sáu thêm ca 13:30–17:00.
-- Đây là dữ liệu minh họa, không phải lịch đã được phòng khám xác nhận.
INSERT INTO doctor_weekly_schedules (doctor_id, weekday, start_time, end_time, slot_duration, is_demo)
SELECT d.id, weekday_values.weekday, time_values.start_time, time_values.end_time, 30, 1
FROM doctors d
CROSS JOIN (
    SELECT 0 AS weekday UNION ALL SELECT 1 UNION ALL SELECT 2
    UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
) AS weekday_values
CROSS JOIN (
    SELECT '08:00:00' AS start_time, '11:30:00' AS end_time
    UNION ALL SELECT '13:30:00', '17:00:00'
) AS time_values
WHERE d.id BETWEEN 1 AND 8
  AND (weekday_values.weekday < 5 OR time_values.start_time = '08:00:00');

INSERT INTO doctor_shifts (doctor_id, shift_date, start_time, end_time, slot_duration, status) VALUES
(1, CURDATE(), '07:30:00', '11:30:00', 30, 'active'),
(1, CURDATE(), '13:30:00', '17:00:00', 30, 'active'),
(2, CURDATE(), '07:30:00', '11:30:00', 30, 'active'),
(3, CURDATE(), '07:30:00', '11:30:00', 30, 'active'),
(4, CURDATE(), '07:30:00', '11:30:00', 30, 'active'),
(5, CURDATE(), '07:30:00', '11:30:00', 30, 'active'),
(6, CURDATE(), '08:00:00', '11:30:00', 30, 'active'),
(7, CURDATE(), '08:00:00', '11:30:00', 30, 'active'),
(8, CURDATE(), '08:00:00', '11:30:00', 30, 'active'),
(1, DATE_ADD(CURDATE(), INTERVAL 1 DAY), '07:30:00', '11:30:00', 30, 'active'),
(2, DATE_ADD(CURDATE(), INTERVAL 1 DAY), '07:30:00', '11:30:00', 30, 'active'),
(3, DATE_ADD(CURDATE(), INTERVAL 1 DAY), '07:30:00', '11:30:00', 30, 'active'),
(4, DATE_ADD(CURDATE(), INTERVAL 1 DAY), '13:30:00', '17:00:00', 30, 'active'),
(5, DATE_ADD(CURDATE(), INTERVAL 1 DAY), '07:30:00', '11:30:00', 30, 'active'),
(6, DATE_ADD(CURDATE(), INTERVAL 1 DAY), '08:00:00', '11:30:00', 30, 'active'),
(7, DATE_ADD(CURDATE(), INTERVAL 1 DAY), '08:00:00', '11:30:00', 30, 'active'),
(8, DATE_ADD(CURDATE(), INTERVAL 1 DAY), '08:00:00', '11:30:00', 30, 'active');

INSERT INTO patients (id, full_name, phone, email, date_of_birth, gender, address) VALUES
(1, 'Nguyễn Văn A', '0912345678', 'nguyenvana@example.com', '1992-05-14', 'Nam', 'TP. Trà Vinh');

INSERT INTO appointments (
    appointment_code, patient_id, doctor_id, specialty_id, shift_id,
    appointment_date, slot_time, end_time,
    patient_name, patient_phone, patient_email, patient_dob, patient_gender,
    reason, status, doctor_notes
) VALUES
('HT-20261029-001', 1, 1, 1, 1, CURDATE(), '08:00:00', '08:30:00', 'Nguyễn Văn A', '0912345678', 'nguyenvana@example.com', '1992-05-14', 'Nam', 'Khám tổng quát định kỳ và kiểm tra huyết áp.', 'confirmed', 'Bệnh nhân có tiền sử huyết áp cao nhẹ.');
-- 7. Bảng contact_messages: Luu biểu mẫu liên hệ từ bệnh nhân/khách
CREATE TABLE IF NOT EXISTS contact_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(120) NULL,
    subject VARCHAR(150) NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
