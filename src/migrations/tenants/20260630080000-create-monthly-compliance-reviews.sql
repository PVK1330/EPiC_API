-- Section N: Monthly Compliance Review
-- Creates the `monthly_compliance_reviews` table that stores a frozen,
-- timestamped snapshot of each sponsor's monthly compliance report.
--
-- One row per (organisation_id, sponsor_id, report_month).
-- The `payload` JSONB column holds all five report sections; top-level scalar
-- columns are denormalised for fast list-view queries.

CREATE TABLE IF NOT EXISTS monthly_compliance_reviews (
  id                          SERIAL PRIMARY KEY,

  organisation_id             INTEGER       NOT NULL
                              REFERENCES organisations (id) ON DELETE CASCADE,

  -- Sponsor (BUSINESS / role_id = 4) user this report was generated for.
  -- NULL for org-wide reports (future use).
  sponsor_id                  INTEGER       REFERENCES users (id) ON DELETE SET NULL,

  -- First day of the calendar month this report covers (e.g. 2025-06-01).
  report_month                DATE          NOT NULL,

  -- Denormalised counters for the list view (no need to deserialise payload).
  total_workers               INTEGER       NOT NULL DEFAULT 0,
  high_risk_count             INTEGER       NOT NULL DEFAULT 0,
  medium_risk_count           INTEGER       NOT NULL DEFAULT 0,
  workers_expiring_in_90_days INTEGER       NOT NULL DEFAULT 0,
  missing_document_count      INTEGER       NOT NULL DEFAULT 0,

  -- Risk score this month (0–100, higher = higher risk).
  risk_score                  NUMERIC(5,2),
  -- Delta vs previous month (+positive = worse, -negative = improved).
  risk_score_delta            NUMERIC(5,2),

  -- 'cron' = automated monthly job, 'manual' = sponsor triggered on-demand.
  generated_by                VARCHAR(10)   NOT NULL DEFAULT 'cron'
                              CHECK (generated_by IN ('cron', 'manual')),

  -- Full five-section JSON payload.
  payload                     JSONB,

  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Speed up sponsor-portal list queries (newest first per sponsor).
CREATE INDEX IF NOT EXISTS idx_monthly_compliance_reviews_sponsor
  ON monthly_compliance_reviews (sponsor_id, report_month DESC);

-- Allows fetching all reviews across a whole org (admin view).
CREATE INDEX IF NOT EXISTS idx_monthly_compliance_reviews_org
  ON monthly_compliance_reviews (organisation_id, report_month DESC);
