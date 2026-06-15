-- Migration: 20260617140000-add-deleted-at-to-licence-applications
--
-- Context
-- -------
-- Enables Sequelize paranoid (soft-delete) mode on the licence_applications
-- table. Previously paranoid was false, so destroy() performed a hard DELETE.
-- After this migration, destroy() sets deleted_at to the current timestamp and
-- the row remains visible only to queries that explicitly opt out of the filter
-- (paranoid: false). Hard-deleted rows cannot be restored.
--
-- Cascade behaviour
-- -----------------
-- Child rows in licence_application_audits, licence_stage_tasks, and
-- licence_appendix_documents reference licence_applications.id with ON DELETE
-- CASCADE. Because the parent row is now soft-deleted (never hard-deleted by the
-- application), those child rows are preserved and the full audit history remains
-- intact. Hard-delete of the parent (via raw SQL or db admin tools) will still
-- cascade and remove all children — that is intentional for GDPR erasure use cases.
--
-- Approved licences
-- -----------------
-- The application layer (deleteLicenceApplication controller) rejects delete
-- requests for Approved licences at the API level. This migration adds no DB
-- constraint for that rule because Approved → Deleted is not a legal FSM
-- transition; enforcing it in the service layer is sufficient.
--
-- Idempotent: safe to run multiple times.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'licence_applications'
      AND column_name  = 'deleted_at'
  ) THEN
    ALTER TABLE "licence_applications"
      ADD COLUMN "deleted_at" TIMESTAMPTZ DEFAULT NULL;

    -- Partial index: only index non-null deleted_at values so that admin
    -- "list deleted" queries are fast without penalising the hot read path.
    CREATE INDEX IF NOT EXISTS "idx_licence_applications_deleted_at"
      ON "licence_applications" ("deleted_at")
      WHERE "deleted_at" IS NOT NULL;
  END IF;
END $$;
