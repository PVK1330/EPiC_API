-- One feedback row per candidate + candidate issue reports (with attachments metadata).
-- Safe dedupe before UNIQUE on candidate_feedbacks.user_id

DELETE FROM "candidate_feedbacks" a
WHERE EXISTS (
  SELECT 1 FROM "candidate_feedbacks" b
  WHERE b."user_id" = a."user_id" AND b."id" < a."id"
);

CREATE UNIQUE INDEX IF NOT EXISTS "candidate_feedbacks_user_id_unique"
  ON "candidate_feedbacks" ("user_id");

CREATE TABLE IF NOT EXISTS "candidate_issue_reports" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "case_id" INTEGER REFERENCES "cases"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  "category" VARCHAR(64) NOT NULL,
  "severity" VARCHAR(32) NOT NULL DEFAULT 'medium',
  "subject" VARCHAR(255) NOT NULL,
  "description" TEXT NOT NULL,
  "attachment_urls" JSONB NOT NULL DEFAULT '[]',
  "status" VARCHAR(32) NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "candidate_issue_reports_user_id_idx" ON "candidate_issue_reports" ("user_id");
CREATE INDEX IF NOT EXISTS "candidate_issue_reports_case_id_idx" ON "candidate_issue_reports" ("case_id");
CREATE INDEX IF NOT EXISTS "candidate_issue_reports_status_idx" ON "candidate_issue_reports" ("status");
