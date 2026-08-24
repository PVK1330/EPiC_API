-- Calendar sync pulls provider events into calendar_meetings keyed by
-- (user_id, meeting_provider, external_event_id). Two syncs overlapping -- a
-- page load and a manual Sync, say -- would otherwise each miss the other's
-- insert and duplicate every meeting on the calendar.
-- Partial: rows created in-app with no provider legitimately share NULLs.

CREATE UNIQUE INDEX IF NOT EXISTS "calendar_meetings_user_provider_external_uniq"
  ON "calendar_meetings" ("user_id", "meeting_provider", "external_event_id")
  WHERE "external_event_id" IS NOT NULL AND "meeting_provider" IS NOT NULL;

-- The calendar reads by user + time window on every page render.
CREATE INDEX IF NOT EXISTS "calendar_meetings_user_start_idx"
  ON "calendar_meetings" ("user_id", "start_time");
