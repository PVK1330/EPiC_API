-- BUG-009: Add ukLicenseNumber column to candidate_applications (idempotent)
ALTER TABLE candidate_applications
  ADD COLUMN IF NOT EXISTS "ukLicenseNumber" VARCHAR(100);
