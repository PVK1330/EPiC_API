-- Rollback for 20260617000000-add-deleted-at-to-sponsored-workers.sql
-- WARNING: this removes all soft-delete state. Run only in non-production environments.

DROP INDEX IF EXISTS idx_sponsored_workers_deleted_at;

ALTER TABLE sponsored_workers
  DROP COLUMN IF EXISTS deleted_at;
