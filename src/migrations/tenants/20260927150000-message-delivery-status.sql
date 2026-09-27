-- Phase 2 UAT 3.4: "each message should show whether it was sent, delivered or failed".
-- sent      = saved (row exists)
-- delivered = the recipient's portal was open when it was sent, or they have
--             opened the portal since (deliveredAt)
-- read      = the recipient opened the conversation (readAt)
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP WITH TIME ZONE;

-- Messages already read were necessarily delivered.
UPDATE "messages"
   SET "readAt" = COALESCE("readAt", "updatedAt"),
       "deliveredAt" = COALESCE("deliveredAt", "updatedAt")
 WHERE "isRead" = true AND ("readAt" IS NULL OR "deliveredAt" IS NULL);

CREATE INDEX IF NOT EXISTS "messages_receiver_undelivered_idx"
  ON "messages" ("receiverId") WHERE "deliveredAt" IS NULL;

-- organisation_id exists on both tables (20260516170000) but was never written.
UPDATE "messages" m SET organisation_id = u.organisation_id
  FROM "users" u WHERE m.organisation_id IS NULL AND u.id = m."senderId";
UPDATE "conversations" c SET organisation_id = u.organisation_id
  FROM "users" u WHERE c.organisation_id IS NULL AND u.id = c."participantOneId";
