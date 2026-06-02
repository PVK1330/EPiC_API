CREATE TABLE IF NOT EXISTS "payment_webhook_retry_queue" (
  "id" SERIAL PRIMARY KEY,
  "event_id" VARCHAR(255) NOT NULL,
  "payload" JSONB NOT NULL,
  "error_reason" TEXT,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "next_retry_at" TIMESTAMPTZ NOT NULL,
  "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_payment_webhook_retry_queue_status" ON "payment_webhook_retry_queue" ("status");
CREATE INDEX IF NOT EXISTS "idx_payment_webhook_retry_queue_next_retry" ON "payment_webhook_retry_queue" ("next_retry_at");
