-- Backfill notifications.organisation_id from the recipient user.
--
-- Historically notifyUser()/generateNotification() created rows without an
-- organisation_id, so every existing notification has organisation_id = NULL.
-- The notifications list endpoint filters by organisation_id, so those rows
-- never appeared in the panel (the bell unread-count worked because it filters
-- only by userId). The service now derives organisation_id from the recipient on
-- create; this backfills the rows that predate that change.
--
-- Runs after 20260601125000 (which renames recipient_id -> userId), so the
-- "userId" column is guaranteed to exist here.

UPDATE "notifications" AS n
SET "organisation_id" = u."organisation_id"
FROM "users" AS u
WHERE n."userId" = u."id"
  AND n."organisation_id" IS NULL
  AND u."organisation_id" IS NOT NULL;
