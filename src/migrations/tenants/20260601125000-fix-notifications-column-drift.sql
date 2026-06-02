-- Fix notifications column-name drift on live tenant databases.
--
-- Some tenant DBs (e.g. epic_ak, epic_test_admin) ran an early version of
-- 20260531000000-align-notifications-to-model.sql that RENAMED the canonical
-- camelCase columns to snake_case (userId -> recipient_id, entityId -> entity_id,
-- entityType -> entity_type, createdAt -> created_at, updatedAt -> updated_at).
-- That migration was later turned into a no-op, but the DBs that already ran it
-- were left drifted, so the Notification model (which expects the camelCase
-- columns) fails with: column Notification.userId does not exist.
--
-- This migration renames the drifted columns back to the canonical names the
-- model/service/controller use. Each rename runs only when the drifted column
-- exists and the canonical one does not, so it is safe (idempotent) on both
-- drifted and already-correct databases.

DO $$
BEGIN
  -- recipient_id -> userId
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'recipient_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'userId') THEN
    ALTER TABLE "notifications" RENAME COLUMN "recipient_id" TO "userId";
  END IF;

  -- entity_id -> entityId
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'entity_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'entityId') THEN
    ALTER TABLE "notifications" RENAME COLUMN "entity_id" TO "entityId";
  END IF;

  -- entity_type -> entityType
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'entity_type')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'entityType') THEN
    ALTER TABLE "notifications" RENAME COLUMN "entity_type" TO "entityType";
  END IF;

  -- created_at -> createdAt
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'created_at')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'createdAt') THEN
    ALTER TABLE "notifications" RENAME COLUMN "created_at" TO "createdAt";
  END IF;

  -- updated_at -> updatedAt
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'updated_at')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notifications' AND column_name = 'updatedAt') THEN
    ALTER TABLE "notifications" RENAME COLUMN "updated_at" TO "updatedAt";
  END IF;
END $$;

-- Recreate the recipient index on the canonical column name.
CREATE INDEX IF NOT EXISTS "idx_notifications_userId" ON "notifications" ("userId");
