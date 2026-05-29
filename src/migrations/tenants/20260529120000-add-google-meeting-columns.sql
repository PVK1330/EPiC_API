-- Migration: Enhance calendar_meetings with provider integrations columns
-- Created at: 2026-05-29

ALTER TABLE "calendar_meetings" 
ADD COLUMN IF NOT EXISTS "meeting_provider" VARCHAR(50) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS "external_event_id" VARCHAR(255) DEFAULT NULL;
