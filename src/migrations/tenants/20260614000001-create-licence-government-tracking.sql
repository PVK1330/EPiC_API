-- Phase 1: Government processing tracking table for sponsor licence applications.
--
-- One row per licence application. Created when the caseworker begins the
-- government portal (SMS / UKVI) registration stage. Stores portal credentials
-- (password encrypted at application layer before INSERT) and all government
-- reference numbers / submission timestamps.

CREATE TABLE IF NOT EXISTS "licence_government_tracking" (
  "id"                              SERIAL PRIMARY KEY,
  "licence_application_id"          INTEGER NOT NULL
                                      REFERENCES "licence_applications" ("id")
                                      ON DELETE CASCADE
                                      ON UPDATE CASCADE,
  "sms_portal_username"             VARCHAR(255),
  "sms_registration_ref"            VARCHAR(100),
  "credentials_generated_at"        TIMESTAMP WITH TIME ZONE,
  "credentials_sent_at"             TIMESTAMP WITH TIME ZONE,
  "ukvi_portal_user_id"             VARCHAR(255),
  "ukvi_portal_password_encrypted"  TEXT,
  "ukvi_credentials_submitted_at"   TIMESTAMP WITH TIME ZONE,
  "government_registration_ref"     VARCHAR(100),
  "government_submission_ref"       VARCHAR(100),
  "government_submission_date"      DATE,
  "created_at"                      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at"                      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lic_gov_tracking_app_id
  ON "licence_government_tracking" ("licence_application_id");

CREATE INDEX IF NOT EXISTS idx_lic_gov_tracking_gov_ref
  ON "licence_government_tracking" ("government_registration_ref");

COMMENT ON COLUMN "licence_government_tracking"."ukvi_portal_password_encrypted"
  IS 'AES-256 encrypted UKVI portal password — never stored in plain text';
