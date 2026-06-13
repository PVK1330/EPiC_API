-- Licence stage tasks — dynamic, per-stage, per-role task assignment
-- Migration: 20260613120000-create-licence-stage-tasks.sql
--
-- Drives the interactive Sponsor Licence "stages" panel. One row per
-- (licence application, stage, role) so each of Sponsor / Caseworker / Admin /
-- Candidate gets their own assignable, completable task at every lifecycle
-- stage. Notifications (in-app + email) fire as these tasks are assigned and
-- completed. The UNIQUE constraint makes seeding idempotent.

CREATE TABLE IF NOT EXISTS "licence_stage_tasks" (
  "id" SERIAL PRIMARY KEY,
  "licence_application_id" INTEGER NOT NULL REFERENCES "licence_applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "stage_key" VARCHAR(50) NOT NULL,
  "stage_order" INTEGER NOT NULL DEFAULT 0,
  "role" VARCHAR(20) NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "assigned_to_user_id" INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "assignee_name" VARCHAR(255),
  "assignee_email" VARCHAR(255),
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "completed_at" TIMESTAMP WITH TIME ZONE,
  "completed_by_user_id" INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "due_date" DATE,
  "metadata" JSONB,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "uq_licence_stage_tasks_app_stage_role" UNIQUE ("licence_application_id", "stage_key", "role")
);

CREATE INDEX IF NOT EXISTS idx_licence_stage_tasks_app
  ON "licence_stage_tasks" ("licence_application_id");
CREATE INDEX IF NOT EXISTS idx_licence_stage_tasks_assignee
  ON "licence_stage_tasks" ("assigned_to_user_id");
CREATE INDEX IF NOT EXISTS idx_licence_stage_tasks_status
  ON "licence_stage_tasks" ("status");
