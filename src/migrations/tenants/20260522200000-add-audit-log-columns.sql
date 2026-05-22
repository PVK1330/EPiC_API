-- Add missing columns to audit_logs table to match the Sequelize model
-- These columns are referenced by the AuditLog model but were absent from the original schema

ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "resource"    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "status"      VARCHAR(20)  NOT NULL DEFAULT 'Success',
  ADD COLUMN IF NOT EXISTS "details"     TEXT;

-- Backfill resource from entity_type where resource is null
UPDATE "audit_logs"
SET "resource" = "entity_type"
WHERE "resource" IS NULL AND "entity_type" IS NOT NULL;

-- Add index for common filter queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_status     ON "audit_logs" ("status");
CREATE INDEX IF NOT EXISTS idx_audit_logs_action     ON "audit_logs" ("action");
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON "audit_logs" ("created_at");
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id    ON "audit_logs" ("user_id");
