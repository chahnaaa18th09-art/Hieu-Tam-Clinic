USE hieu_tam_clinic;

ALTER TABLE appointments
    MODIFY COLUMN status ENUM('pending', 'confirmed', 'completed', 'cancelled', 'rejected', 'expired')
        NOT NULL DEFAULT 'pending',
    ADD COLUMN hold_expires_at DATETIME NULL AFTER status,
    ADD COLUMN idempotency_key VARCHAR(64) NULL AFTER hold_expires_at,
    ADD COLUMN request_fingerprint CHAR(64) NULL AFTER idempotency_key,
    ADD COLUMN reviewed_by INT NULL AFTER request_fingerprint,
    ADD COLUMN reviewed_at DATETIME NULL AFTER reviewed_by,
    ADD UNIQUE KEY uq_appointment_idempotency (idempotency_key),
    ADD INDEX idx_appointment_hold_expiry (status, hold_expires_at),
    ADD CONSTRAINT fk_appointment_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;

UPDATE appointments
SET hold_expires_at = DATE_ADD(created_at, INTERVAL 60 MINUTE)
WHERE status = 'pending' AND hold_expires_at IS NULL;
