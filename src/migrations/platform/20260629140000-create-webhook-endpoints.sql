-- Week 9 Task 2: Webhook System — tenant-registered endpoints
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id              SERIAL PRIMARY KEY,
  organisation_id INTEGER       NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  url             TEXT          NOT NULL,
  secret          VARCHAR(255)  NOT NULL,
  events          TEXT[]        NOT NULL DEFAULT '{}',
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  description     TEXT,
  created_by      INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_org_id    ON webhook_endpoints(organisation_id);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_is_active ON webhook_endpoints(is_active) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS webhook_delivery_logs (
  id                  SERIAL PRIMARY KEY,
  webhook_endpoint_id INTEGER      NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type          VARCHAR(100) NOT NULL,
  payload             JSONB        NOT NULL DEFAULT '{}',
  status              VARCHAR(20)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed','retrying')),
  response_status     INTEGER,
  response_body       TEXT,
  attempt_count       INTEGER      NOT NULL DEFAULT 0,
  next_retry_at       TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_endpoint_id ON webhook_delivery_logs(webhook_endpoint_id);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_status      ON webhook_delivery_logs(status);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_next_retry  ON webhook_delivery_logs(next_retry_at) WHERE status = 'retrying';
