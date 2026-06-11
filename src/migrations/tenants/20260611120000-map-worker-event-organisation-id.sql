-- Map worker_events.organisation_id (the column already exists from the
-- create migration, but the Sequelize model never mapped it, so writes silently
-- dropped it and old rows have a NULL scope). This migration is a safety net for
-- the column + index and backfills existing data so the new WorkerEvent ->
-- Organisation association returns a real organisation for historical rows.
--
-- Idempotent: safe to run more than once.

-- 1. Ensure the column exists (no-op when already present).
ALTER TABLE IF EXISTS "worker_events"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER
  REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Backfill from each event's sponsor organisation (most accurate scope).
UPDATE "worker_events" we
SET "organisation_id" = u."organisation_id"
FROM "users" u
WHERE we."organisation_id" IS NULL
  AND we."sponsorId" = u."id"
  AND u."organisation_id" IS NOT NULL;

-- 3. Fallback for any rows still unscoped (e.g. sponsor had no organisation):
--    inherit the first organisation, matching the convention used when
--    organisation_id was first added to the other tenant tables.
DO $$
DECLARE
  org_id INTEGER;
BEGIN
  SELECT id INTO org_id FROM organisations ORDER BY id ASC LIMIT 1;
  IF org_id IS NOT NULL THEN
    UPDATE "worker_events"
    SET "organisation_id" = org_id
    WHERE "organisation_id" IS NULL;
  END IF;
END $$;

-- 4. Index the scope column for tenant-filtered queries (alerts, reviews).
CREATE INDEX IF NOT EXISTS "idx_worker_events_organisation_id"
  ON "worker_events" ("organisation_id");
