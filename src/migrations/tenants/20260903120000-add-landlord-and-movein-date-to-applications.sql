-- BUG-007: Add Move-in / Start Date, Housing Status, and Landlord Details to candidate_applications and unverified_users (idempotent)
ALTER TABLE candidate_applications
  ADD COLUMN IF NOT EXISTS "addressStartDate" DATE,
  ADD COLUMN IF NOT EXISTS "housingStatus" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "landlordName" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "landlordContactNumber" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "landlordEmail" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "landlordAddress" TEXT;

ALTER TABLE unverified_users
  ADD COLUMN IF NOT EXISTS "profile_data" JSONB DEFAULT '{}'::jsonb;
