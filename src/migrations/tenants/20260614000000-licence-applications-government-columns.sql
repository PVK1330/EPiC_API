-- Phase 1: Add government processing tracking columns to licence_applications.
-- These columns mirror the headline refs/dates on the parent row so queries
-- can filter/sort without joining licence_government_tracking.

ALTER TABLE "licence_applications"
  ADD COLUMN IF NOT EXISTS "government_registration_ref" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "government_submission_ref"   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "government_submission_date"  DATE,
  ADD COLUMN IF NOT EXISTS "review_started_at"           TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN "licence_applications"."government_registration_ref"
  IS 'Reference number assigned by UKVI SMS portal on registration';
COMMENT ON COLUMN "licence_applications"."government_submission_ref"
  IS 'Reference number assigned after online application form submission';
COMMENT ON COLUMN "licence_applications"."government_submission_date"
  IS 'Date the application form was formally submitted to UKVI';
COMMENT ON COLUMN "licence_applications"."review_started_at"
  IS 'Timestamp when status moved to Under Review (caseworker assigned)';
