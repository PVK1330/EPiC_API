-- Sponsor Compliance Review Workflow
-- Migration: 20260610160000-sponsor-compliance-review-workflow.sql
--
-- Adds a review workflow (Submitted -> Under Review -> Approved | Rejected |
-- Information Requested) to Right-to-Work checks, Worker Events and Sponsor
-- Change Requests via a dedicated `review_status` (+ reviewer columns), plus a
-- shared, immutable `compliance_review_history` trail. The entities' existing
-- operational `status` columns are left untouched.

-- 1) Review columns on each entity (existing rows default to 'Submitted').
ALTER TABLE "right_to_work_records"
  ADD COLUMN IF NOT EXISTS "review_status" VARCHAR(30) NOT NULL DEFAULT 'Submitted',
  ADD COLUMN IF NOT EXISTS "reviewed_by"   INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD COLUMN IF NOT EXISTS "reviewed_at"   TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "review_notes"  TEXT;

ALTER TABLE "worker_events"
  ADD COLUMN IF NOT EXISTS "review_status" VARCHAR(30) NOT NULL DEFAULT 'Submitted',
  ADD COLUMN IF NOT EXISTS "reviewed_by"   INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD COLUMN IF NOT EXISTS "reviewed_at"   TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "review_notes"  TEXT;

ALTER TABLE "sponsor_change_requests"
  ADD COLUMN IF NOT EXISTS "review_status" VARCHAR(30) NOT NULL DEFAULT 'Submitted',
  ADD COLUMN IF NOT EXISTS "reviewed_by"   INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD COLUMN IF NOT EXISTS "reviewed_at"   TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "review_notes"  TEXT;

-- 2) Shared, immutable review history (polymorphic over entity_type/entity_id).
CREATE TABLE IF NOT EXISTS "compliance_review_history" (
  "id" SERIAL PRIMARY KEY,
  "entity_type" VARCHAR(50) NOT NULL,
  "entity_id" INTEGER NOT NULL,
  "actor_id" INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "action" VARCHAR(50) NOT NULL,
  "previous_status" VARCHAR(50),
  "new_status" VARCHAR(50),
  "notes" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_review_history_entity
  ON "compliance_review_history" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS idx_compliance_review_history_actor
  ON "compliance_review_history" ("actor_id");
