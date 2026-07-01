-- Week 9 Task 3: Usage Metering Engine — per-tenant monthly usage tracking
CREATE TABLE IF NOT EXISTS usage_meters (
  id              SERIAL PRIMARY KEY,
  organisation_id INTEGER     NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  period_year     INTEGER     NOT NULL,
  period_month    INTEGER     NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  cases_created   INTEGER     NOT NULL DEFAULT 0,
  active_users    INTEGER     NOT NULL DEFAULT 0,
  storage_bytes   BIGINT      NOT NULL DEFAULT 0,
  api_calls       INTEGER     NOT NULL DEFAULT 0,
  workers_count   INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS idx_usage_meters_org_id ON usage_meters(organisation_id);
CREATE INDEX IF NOT EXISTS idx_usage_meters_period ON usage_meters(period_year, period_month);
