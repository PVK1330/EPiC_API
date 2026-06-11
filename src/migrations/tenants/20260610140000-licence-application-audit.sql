-- Caseworker assignment enforcement — licence application audit trail
-- Migration: 20260610140000-licence-application-audit.sql
--
-- Immutable trail capturing assignment history (admin assigns/reassigns
-- caseworkers) and reviewer actions (approve / reject / request information /
-- under review) for licence applications.

CREATE TABLE IF NOT EXISTS "licence_application_audits" (
  "id" SERIAL PRIMARY KEY,
  "licence_application_id" INTEGER NOT NULL REFERENCES "licence_applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "actor_id" INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "action" VARCHAR(50) NOT NULL,
  "previous_status" VARCHAR(50),
  "new_status" VARCHAR(50),
  "assigned_caseworker_ids" JSONB,
  "notes" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_licence_application_audits_app
  ON "licence_application_audits" ("licence_application_id");
CREATE INDEX IF NOT EXISTS idx_licence_application_audits_actor
  ON "licence_application_audits" ("actor_id");
CREATE INDEX IF NOT EXISTS idx_licence_application_audits_action
  ON "licence_application_audits" ("action");
