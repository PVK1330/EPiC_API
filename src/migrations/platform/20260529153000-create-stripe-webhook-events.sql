CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
  "id" SERIAL PRIMARY KEY,
  "event_id" VARCHAR(255) NOT NULL UNIQUE,
  "event_type" VARCHAR(255) NOT NULL,
  "stripe_account_id" VARCHAR(255),
  "tenant_id" INTEGER,
  "processed_at" TIMESTAMPTZ,
  "processing_status" VARCHAR(50) NOT NULL DEFAULT 'pending',
  "error_message" TEXT,
  "payload_hash" VARCHAR(255),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_stripe_webhook_events_event_id" ON "stripe_webhook_events" ("event_id");
CREATE INDEX IF NOT EXISTS "idx_stripe_webhook_events_tenant_id" ON "stripe_webhook_events" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_stripe_webhook_events_status" ON "stripe_webhook_events" ("processing_status");
