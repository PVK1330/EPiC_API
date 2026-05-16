-- Migration: add isLocked and submittedAt to candidate_applications
-- Column names are quoted camelCase to match what Sequelize generates without
-- the `underscored` option (the rest of the table already uses camelCase columns).

ALTER TABLE candidate_applications
  ADD COLUMN IF NOT EXISTS "isLocked"    BOOLEAN                  DEFAULT false,
  ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP WITH TIME ZONE;
