CREATE TABLE IF NOT EXISTS "integration_sync_logs" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" VARCHAR(50) NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "entity_type" VARCHAR(100),
  "entity_id" VARCHAR(255),
  "status" VARCHAR(50) NOT NULL,
  "details" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_integration_sync_logs_user" ON "integration_sync_logs" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_integration_sync_logs_provider" ON "integration_sync_logs" ("provider");
