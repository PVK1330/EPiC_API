-- Week 6: 30-day post-closure portal access rule
-- Adds closed_at timestamp to cases so we know exactly when a case was closed.

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ DEFAULT NULL;

-- Backfill existing Closed cases with updated_at as a proxy
UPDATE cases
  SET closed_at = updated_at
  WHERE status = 'Closed' AND closed_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cases_closed_at
  ON cases (closed_at)
  WHERE closed_at IS NOT NULL;
