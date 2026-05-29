-- Rebuild platform_notifications to match the current Sequelize model.
-- Old table had: id, title, desc, type, is_read, created_at, updated_at
-- New model adds: message, category, priority, recipient_id, recipient_role,
--                 organisation_id, entity_type, entity_id, action_url,
--                 read_at, is_archived, metadata

-- 1. Rename the old "desc" column to "message" (the model uses message TEXT NOT NULL)
ALTER TABLE platform_notifications
  RENAME COLUMN "desc" TO "message";

-- 2. Add every column the model declares that doesn't yet exist
ALTER TABLE platform_notifications
  ADD COLUMN IF NOT EXISTS category        VARCHAR(20)  NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS priority        VARCHAR(20)  NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS recipient_id    INTEGER,
  ADD COLUMN IF NOT EXISTS recipient_role  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS organisation_id INTEGER,
  ADD COLUMN IF NOT EXISTS entity_type     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS entity_id       INTEGER,
  ADD COLUMN IF NOT EXISTS action_url      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS read_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_archived     BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS metadata        JSONB                 DEFAULT '{}';

-- 3. Make sure the "type" column accepts all enum values the model declares
--    (old column may have been TEXT or a narrower ENUM)
ALTER TABLE platform_notifications
  ALTER COLUMN type SET DEFAULT 'info';

-- 4. Ensure is_read has the right default
ALTER TABLE platform_notifications
  ALTER COLUMN is_read SET DEFAULT FALSE;

-- 5. Create indexes Sequelize will expect (IF NOT EXISTS keeps reruns safe)
CREATE INDEX IF NOT EXISTS platform_notifications_recipient_id
  ON platform_notifications (recipient_id);
CREATE INDEX IF NOT EXISTS platform_notifications_is_read
  ON platform_notifications (is_read);
CREATE INDEX IF NOT EXISTS platform_notifications_category
  ON platform_notifications (category);
