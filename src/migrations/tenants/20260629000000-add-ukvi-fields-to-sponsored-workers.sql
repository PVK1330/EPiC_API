-- Add full UKVI-required fields to sponsored_workers.
-- These fields are needed to properly track sponsored worker information
-- as required by UK Visas and Immigration (UKVI) compliance.

ALTER TABLE sponsored_workers
  ADD COLUMN IF NOT EXISTS dob                  DATE           NULL,
  ADD COLUMN IF NOT EXISTS gender               VARCHAR(20)    NULL,
  ADD COLUMN IF NOT EXISTS marital_status       VARCHAR(30)    NULL,
  ADD COLUMN IF NOT EXISTS passport_number      VARCHAR(50)    NULL,
  ADD COLUMN IF NOT EXISTS passport_issue_date  DATE           NULL,
  ADD COLUMN IF NOT EXISTS passport_expiry_date DATE           NULL,
  ADD COLUMN IF NOT EXISTS passport_country     VARCHAR(100)   NULL,
  ADD COLUMN IF NOT EXISTS phone                VARCHAR(30)    NULL,
  ADD COLUMN IF NOT EXISTS address              TEXT           NULL,
  ADD COLUMN IF NOT EXISTS city                 VARCHAR(100)   NULL,
  ADD COLUMN IF NOT EXISTS job_title            VARCHAR(150)   NULL,
  ADD COLUMN IF NOT EXISTS department           VARCHAR(150)   NULL,
  ADD COLUMN IF NOT EXISTS soc_code             VARCHAR(20)    NULL,
  ADD COLUMN IF NOT EXISTS start_date           DATE           NULL,
  ADD COLUMN IF NOT EXISTS salary               NUMERIC(12,2)  NULL,
  ADD COLUMN IF NOT EXISTS weekly_hours         NUMERIC(5,2)   NULL,
  ADD COLUMN IF NOT EXISTS previous_uk_visa     BOOLEAN        NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS worker_cos_number    VARCHAR(60)    NULL;

-- Unique index on the auto-generated CoS number so no two workers share one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsored_workers_cos_number
  ON sponsored_workers (worker_cos_number)
  WHERE worker_cos_number IS NOT NULL AND deleted_at IS NULL;
