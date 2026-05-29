CREATE TABLE IF NOT EXISTS "meeting_integrations" (
  "id" SERIAL PRIMARY KEY,
  "appointment_id" INTEGER NOT NULL REFERENCES "appointments"("id") ON DELETE CASCADE,
  "provider" VARCHAR(50) NOT NULL,
  "provider_meeting_id" VARCHAR(255) NOT NULL,
  "join_url" TEXT,
  "status" VARCHAR(50) NOT NULL DEFAULT 'active',
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_meeting_integrations_appt" ON "meeting_integrations" ("appointment_id");
CREATE INDEX IF NOT EXISTS "idx_meeting_integrations_provider" ON "meeting_integrations" ("provider", "provider_meeting_id");
