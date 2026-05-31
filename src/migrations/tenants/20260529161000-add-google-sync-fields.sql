ALTER TABLE "meeting_integrations"
ADD COLUMN IF NOT EXISTS "provider_calendar_event_id" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "sync_status" VARCHAR(50) DEFAULT 'SYNCED';
