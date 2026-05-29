-- Phase 3: Create generic Change Request Management System tables

CREATE TABLE IF NOT EXISTS "change_requests" (
  "id" SERIAL PRIMARY KEY,
  "entity_type" VARCHAR(100) NOT NULL,
  "entity_id" VARCHAR(100) NOT NULL,
  "case_id" INTEGER DEFAULT NULL,
  
  "field_name" VARCHAR(100) NOT NULL,
  "old_value" JSONB,
  "requested_value" JSONB,
  "reason" TEXT,
  
  "change_category" VARCHAR(100) NOT NULL,
  "risk_level" VARCHAR(50) NOT NULL,
  
  "status" VARCHAR(50) NOT NULL DEFAULT 'SUBMITTED',
  
  "submitted_by" INTEGER NOT NULL,
  "reviewed_by" INTEGER DEFAULT NULL,
  "review_notes" TEXT,
  
  "organisation_id" INTEGER DEFAULT NULL,
  
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "change_request_history" (
  "id" SERIAL PRIMARY KEY,
  "change_request_id" INTEGER NOT NULL REFERENCES "change_requests" ("id") ON DELETE CASCADE,
  "action" VARCHAR(50) NOT NULL,
  "performed_by" INTEGER NOT NULL,
  "role" VARCHAR(50),
  "notes" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for quick filtering and lookups
CREATE INDEX IF NOT EXISTS "idx_cr_entity" ON "change_requests" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "idx_cr_status" ON "change_requests" ("status");
CREATE INDEX IF NOT EXISTS "idx_cr_org" ON "change_requests" ("organisation_id");
CREATE INDEX IF NOT EXISTS "idx_cr_history_cr_id" ON "change_request_history" ("change_request_id");
