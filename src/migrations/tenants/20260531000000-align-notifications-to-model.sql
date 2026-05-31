-- Align the tenant "notifications" table with the Notification Sequelize model.
-- The model expects: recipient_id, recipient_role, category, entity_id, entity_type,
-- action_url, is_archived, created_at, updated_at. The original 006 table shipped
-- with userId / entityId / entityType / createdAt / updatedAt and no category /
-- action_url / is_archived, so every model query (e.g. unread-count filtering on
-- recipient_id) failed with "column ... does not exist". This brings the columns
-- in line without dropping existing rows.

DO $$
BEGIN
  -- userId -> recipient_id
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'userId')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'recipient_id') THEN
    ALTER TABLE "notifications" RENAME COLUMN "userId" TO "recipient_id";
  END IF;

  -- entityId -> entity_id
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'entityId')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'entity_id') THEN
    ALTER TABLE "notifications" RENAME COLUMN "entityId" TO "entity_id";
  END IF;

  -- entityType -> entity_type
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'entityType')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'entity_type') THEN
    ALTER TABLE "notifications" RENAME COLUMN "entityType" TO "entity_type";
  END IF;

  -- createdAt -> created_at
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'createdAt')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'created_at') THEN
    ALTER TABLE "notifications" RENAME COLUMN "createdAt" TO "created_at";
  END IF;

  -- updatedAt -> updated_at
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'updatedAt')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'updated_at') THEN
    ALTER TABLE "notifications" RENAME COLUMN "updatedAt" TO "updated_at";
  END IF;
END $$;

-- Columns the model expects that the original table lacked.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "category" VARCHAR(50) NOT NULL DEFAULT 'system';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "recipient_role" VARCHAR(50);
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "action_url" VARCHAR(255);
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "is_archived" BOOLEAN DEFAULT FALSE;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "metadata" JSONB DEFAULT '{}';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER;

-- Index used by unread-count and list-by-recipient queries.
CREATE INDEX IF NOT EXISTS "notifications_recipient_id" ON "notifications" ("recipient_id");
