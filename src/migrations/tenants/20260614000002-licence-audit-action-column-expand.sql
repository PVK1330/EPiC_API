-- Phase 1: Expand licence_application_audits.action column from VARCHAR(50)
-- to VARCHAR(100) to accommodate the new government-pipeline action tokens,
-- the longest of which is 'government_registration_completed' (33 chars).
--
-- New valid action values (enforced by LICENCE_AUDIT_ACTIONS in application code):
--   review_started                  — status moved to Under Review
--   government_registration_started — SMS portal registration initiated
--   government_registration_completed — SMS portal registration confirmed
--   credentials_generated           — UKVI portal credentials created
--   credentials_requested           — credentials sent to sponsor for review
--   credentials_received            — sponsor confirmed credential receipt
--   government_forms_completed      — online application forms filled
--   government_submitted            — application formally submitted to UKVI
--   decision_pending                — awaiting UKVI decision

ALTER TABLE "licence_application_audits"
  ALTER COLUMN "action" TYPE VARCHAR(100);
