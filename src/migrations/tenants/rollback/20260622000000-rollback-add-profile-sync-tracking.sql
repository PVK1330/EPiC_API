-- Rollback: remove the Business Profile sync-tracking columns.

ALTER TABLE "licence_authorising_officer"
  DROP COLUMN IF EXISTS "last_synced_by_user_id",
  DROP COLUMN IF EXISTS "last_synced_at";

ALTER TABLE "licence_key_contact"
  DROP COLUMN IF EXISTS "last_synced_by_user_id",
  DROP COLUMN IF EXISTS "last_synced_at";

ALTER TABLE "licence_level1_users"
  DROP COLUMN IF EXISTS "last_synced_by_user_id",
  DROP COLUMN IF EXISTS "last_synced_at";

ALTER TABLE "licence_organisation_info"
  DROP COLUMN IF EXISTS "last_synced_by_user_id",
  DROP COLUMN IF EXISTS "last_synced_at";
