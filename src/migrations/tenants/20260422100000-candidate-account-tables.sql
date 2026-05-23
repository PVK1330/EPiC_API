-- Candidate self-service: preferences/consent + feedback (per user_id). Scoped to candidates via API.
-- Requires "users". Timestamps match Sequelize defaults.

CREATE TABLE IF NOT EXISTS "candidate_account_settings" (
  "user_id" INTEGER PRIMARY KEY REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "notification_document_requests" BOOLEAN NOT NULL DEFAULT TRUE,
  "notification_case_status" BOOLEAN NOT NULL DEFAULT TRUE,
  "notification_payment_reminders" BOOLEAN NOT NULL DEFAULT TRUE,
  "notification_deadline_alerts" BOOLEAN NOT NULL DEFAULT FALSE,
  "terms_accepted_at" TIMESTAMP WITH TIME ZONE,
  "terms_version" VARCHAR(64),
  "data_deletion_requested_at" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "candidate_feedbacks" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "rating" SMALLINT NOT NULL,
  "experience_tags" JSONB NOT NULL DEFAULT '[]',
  "comments" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "candidate_feedbacks_user_id_idx" ON "candidate_feedbacks" ("user_id");
