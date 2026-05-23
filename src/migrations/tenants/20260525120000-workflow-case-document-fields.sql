-- Workflow: document rejection reason, proposed amount, biometric booking columns

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS proposed_amount DECIMAL(10, 2);

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS biometric_location VARCHAR(500);

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS biometric_time VARCHAR(64);

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS biometric_day VARCHAR(32);
