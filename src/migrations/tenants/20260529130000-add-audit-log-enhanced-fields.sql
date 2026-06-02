-- Phase 2: Add enhanced audit log fields for field-level tracking and candidate profiles
ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "entity_type" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "entity_id"   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "field_name"  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "role"        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "user_agent"  TEXT;

-- Add indexes for the new Explorer API filters
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON "audit_logs" ("entity_type");
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_id   ON "audit_logs" ("entity_id");
CREATE INDEX IF NOT EXISTS idx_audit_logs_role        ON "audit_logs" ("role");
