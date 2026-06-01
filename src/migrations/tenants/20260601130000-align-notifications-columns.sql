-- Align the notifications table with the Notification model + service.
-- The base table (006_core_business_tables.sql) already provides:
--   userId, roleId, type, priority, title, message, actionType, entityId,
--   entityType, metadata, is_read, read_at, send_email, email_sent,
--   scheduled_for, sent_at, expires_at, createdAt, updatedAt
-- and 20260516170000 added organisation_id.
--
-- These three feature columns were referenced by the model/service but never
-- existed in the table (the source of the schema-drift bug). Add them here.
ALTER TABLE IF EXISTS "notifications"
  ADD COLUMN IF NOT EXISTS "category" VARCHAR(50) NOT NULL DEFAULT 'system';

ALTER TABLE IF EXISTS "notifications"
  ADD COLUMN IF NOT EXISTS "action_url" VARCHAR(255);

ALTER TABLE IF EXISTS "notifications"
  ADD COLUMN IF NOT EXISTS "is_archived" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS "idx_notifications_userId" ON "notifications" ("userId");
CREATE INDEX IF NOT EXISTS "idx_notifications_category" ON "notifications" ("category");
CREATE INDEX IF NOT EXISTS "idx_notifications_is_archived" ON "notifications" ("is_archived");
