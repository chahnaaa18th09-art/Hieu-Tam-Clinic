USE hieu_tam_clinic;

ALTER TABLE appointments
    ADD COLUMN schedule_source ENUM('clinic', 'demo') NOT NULL DEFAULT 'clinic' AFTER hold_expires_at;

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
