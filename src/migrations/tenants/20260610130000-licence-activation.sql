-- Phase 4 — Licence Activation
-- Migration: 20260610130000-licence-activation.sql
--
-- 1) Ensure the activation columns exist on sponsor_profiles (defensive).
-- 2) Default licenceStatus to 'Pending' so sponsors are only Active once their
--    licence application is approved (Phase 4).
-- 3) Conservatively backfill: downgrade only sponsors that were never activated
--    (no licence number AND no approved licence application). Genuinely licensed
--    sponsors are left untouched.

-- 1) Defensive column existence (already present in current schema).
ALTER TABLE "sponsor_profiles"
  ADD COLUMN IF NOT EXISTS "licenseNumber"     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "licenceIssueDate"  TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "licenceExpiryDate" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "licenceStatus"     VARCHAR(20);

-- 2) New default for newly created sponsor profiles.
ALTER TABLE "sponsor_profiles"
  ALTER COLUMN "licenceStatus" SET DEFAULT 'Pending';

-- 3) Conservative backfill of never-activated sponsors only.
UPDATE "sponsor_profiles" sp
SET "licenceStatus" = 'Pending'
WHERE ("licenceStatus" IS NULL OR "licenceStatus" = 'Active')
  AND ("licenseNumber" IS NULL OR "licenseNumber" = '')
  AND NOT EXISTS (
    SELECT 1
    FROM "licence_applications" la
    WHERE la."userId" = sp."userId"
      AND la."status" = 'Approved'
  );
