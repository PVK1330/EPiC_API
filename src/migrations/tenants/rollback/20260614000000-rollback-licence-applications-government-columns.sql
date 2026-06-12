-- Rollback: Remove government processing columns from licence_applications.

ALTER TABLE "licence_applications"
  DROP COLUMN IF EXISTS "government_registration_ref",
  DROP COLUMN IF EXISTS "government_submission_ref",
  DROP COLUMN IF EXISTS "government_submission_date",
  DROP COLUMN IF EXISTS "review_started_at";
