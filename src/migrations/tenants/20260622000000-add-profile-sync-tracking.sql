-- Business Profile is the primary source for Authorising Officer, Key Contact,
-- Level 1 Users and Company registration. When those records are synced from the
-- profile we record WHEN and BY WHOM so the wizard can show an
-- "Imported From Business Profile" badge with an accurate timestamp (replacing
-- the previous localStorage-only tracking).
--
-- All columns are nullable and additive — existing applications are unaffected
-- (a null last_synced_at simply means "never synced / manually entered").
-- Idempotent: safe to re-run.

ALTER TABLE "licence_authorising_officer"
  ADD COLUMN IF NOT EXISTS "last_synced_at" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "last_synced_by_user_id" INTEGER;

ALTER TABLE "licence_key_contact"
  ADD COLUMN IF NOT EXISTS "last_synced_at" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "last_synced_by_user_id" INTEGER;

ALTER TABLE "licence_level1_users"
  ADD COLUMN IF NOT EXISTS "last_synced_at" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "last_synced_by_user_id" INTEGER;

ALTER TABLE "licence_organisation_info"
  ADD COLUMN IF NOT EXISTS "last_synced_at" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "last_synced_by_user_id" INTEGER;

COMMENT ON COLUMN "licence_authorising_officer"."last_synced_at"
  IS 'When this record was last synced from the Business Profile (null = manual entry).';
COMMENT ON COLUMN "licence_key_contact"."last_synced_at"
  IS 'When this record was last synced from the Business Profile (null = manual entry).';
COMMENT ON COLUMN "licence_level1_users"."last_synced_at"
  IS 'When this record was last synced from the Business Profile (null = manual entry).';
COMMENT ON COLUMN "licence_organisation_info"."last_synced_at"
  IS 'When company fields were last synced from the Business Profile (null = manual entry).';
