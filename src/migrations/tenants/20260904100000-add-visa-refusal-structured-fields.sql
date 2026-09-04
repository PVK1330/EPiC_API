-- BUG-013: Add structured visa refusal detail columns to candidate_applications (idempotent)
ALTER TABLE candidate_applications
  ADD COLUMN IF NOT EXISTS "refusedVisaReason" TEXT,
  ADD COLUMN IF NOT EXISTS "refusedVisaDate" DATE,
  ADD COLUMN IF NOT EXISTS "refusedVisaCountry" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "refusedVisaType" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "refusedVisaReference" VARCHAR(100);
