-- P2-WM-13: Add soft-delete support to sponsored_workers.
-- UK immigration compliance requires that worker records are never physically
-- removed. This column enables Sequelize paranoid mode: a non-NULL value means
-- the row is logically deleted and is excluded from all standard queries.

ALTER TABLE sponsored_workers
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL DEFAULT NULL;

-- Partial index: only non-deleted rows are indexed so the planner can skip
-- deleted records cheaply in the common (non-deleted) query path.
CREATE INDEX IF NOT EXISTS idx_sponsored_workers_deleted_at
  ON sponsored_workers (deleted_at)
  WHERE deleted_at IS NULL;
