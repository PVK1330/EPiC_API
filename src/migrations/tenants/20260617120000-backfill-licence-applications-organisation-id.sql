-- Migration: 20260617120000-backfill-licence-applications-organisation-id
--
-- Context
-- -------
-- The `organisation_id` column was added to `licence_applications` in
-- migration 20260516170000 with a blanket backfill (first-org ID for all rows).
-- However, the Sequelize model did NOT declare the `organisationId` attribute,
-- so every application created after that migration had NULL in this column
-- because Sequelize silently dropped the field from its INSERT statements.
--
-- This migration performs a precise, per-row backfill: it joins each licence
-- application to its submitting user and copies the user's `organisation_id`.
-- The join is correct because in a multi-tenant setup the sponsor user always
-- belongs to exactly one organisation, which is the owning org of the licence.
--
-- Safety
-- ------
-- All statements use IF EXISTS / WHERE NULL guards and wrap in a DO block so
-- they are idempotent — safe to run multiple times without side effects.

DO $$
BEGIN
  -- 1. Ensure the column exists (guard against running on a schema that never
  --    had the 20260516170000 migration applied).
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'licence_applications'
      AND column_name  = 'organisation_id'
  ) THEN
    ALTER TABLE "licence_applications"
      ADD COLUMN "organisation_id" INTEGER
        REFERENCES "organisations" ("id")
        ON DELETE SET NULL
        ON UPDATE CASCADE;

    CREATE INDEX IF NOT EXISTS "idx_licence_applications_organisation_id"
      ON "licence_applications" ("organisation_id");
  END IF;

  -- 2. Backfill rows that still have NULL organisation_id by joining to the
  --    submitting user's organisation_id.
  UPDATE "licence_applications" la
  SET    organisation_id = u.organisation_id
  FROM   "users" u
  WHERE  la.user_id         = u.id
    AND  la.organisation_id IS NULL
    AND  u.organisation_id  IS NOT NULL;

  -- 3. Any rows whose submitting user has no organisation_id fall back to the
  --    first (oldest) organisation in this tenant schema.  This handles legacy
  --    seed / test data where users were created without an org assignment.
  UPDATE "licence_applications"
  SET    organisation_id = (SELECT id FROM "organisations" ORDER BY id ASC LIMIT 1)
  WHERE  organisation_id IS NULL;

END $$;
