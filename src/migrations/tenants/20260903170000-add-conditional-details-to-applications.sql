-- BUG-011: Add conditional detail columns to candidate_applications (idempotent)
ALTER TABLE candidate_applications
  ADD COLUMN IF NOT EXISTS "medicalTreatmentDetails" TEXT,
  ADD COLUMN IF NOT EXISTS "refusedVisaDetails" TEXT,
  ADD COLUMN IF NOT EXISTS "refusedEntryDetails" TEXT,
  ADD COLUMN IF NOT EXISTS "refusedPermissionDetails" TEXT,
  ADD COLUMN IF NOT EXISTS "refusedAsylumDetails" TEXT,
  ADD COLUMN IF NOT EXISTS "deportedDetails" TEXT,
  ADD COLUMN IF NOT EXISTS "removedDetails" TEXT,
  ADD COLUMN IF NOT EXISTS "requiredToLeaveDetails" TEXT,
  ADD COLUMN IF NOT EXISTS "bannedDetails" TEXT,
  ADD COLUMN IF NOT EXISTS "illegalEntryDetails" TEXT,
  ADD COLUMN IF NOT EXISTS "overstayedDetails" TEXT,
  ADD COLUMN IF NOT EXISTS "breachDetails" TEXT,
  ADD COLUMN IF NOT EXISTS "falseInfoDetails" TEXT,
  ADD COLUMN IF NOT EXISTS "otherBreachDetails" TEXT,
  ADD COLUMN IF NOT EXISTS "sponsoredDetails" TEXT;
