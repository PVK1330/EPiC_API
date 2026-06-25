-- ── Sponsor Licence Flow v2 ────────────────────────────────────────────────────
-- Changes:
--   1. Add new columns to licence_government_tracking (home-office dispatch fields +
--      credentials-requested timestamp)
--   2. Add new columns to licence_applications (UKVI payment confirmation +
--      rejection cooldown)
--   3. Renumber stage tasks: remove payment stage from position 8,
--      shift stages 9-18 down by 1, rename payment→payment_confirmation at order 17,
--      insert home_office_document_dispatch at order 16,
--      submission at 18, decision_activation at 19.
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. licence_government_tracking: new columns
ALTER TABLE licence_government_tracking
  ADD COLUMN IF NOT EXISTS ukvi_credentials_requested_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS home_office_doc_deadline       DATE,
  ADD COLUMN IF NOT EXISTS home_office_docs_sent_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS home_office_docs_ref           VARCHAR(255);

-- 2. licence_applications: new columns
ALTER TABLE licence_applications
  ADD COLUMN IF NOT EXISTS ukvi_payment_confirmed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_cooldown_until   DATE;

-- 3. Stage-task renumbering (run in safe order to avoid transient conflicts)

-- Step A: Bump submission (17→18) and decision_activation (18→19) first to free up slots
UPDATE licence_stage_tasks SET stage_order = 19 WHERE stage_key = 'decision_activation';
UPDATE licence_stage_tasks SET stage_order = 18 WHERE stage_key = 'submission';

-- Step B: Rename payment→payment_confirmation and move to order 17
UPDATE licence_stage_tasks
  SET stage_key   = 'payment_confirmation',
      stage_order = 17,
      title       = 'Pay the UKVI licence fee directly on the UKVI portal. Once payment is confirmed, tick the task below as complete.'
  WHERE stage_key = 'payment' AND role = 'sponsor';

UPDATE licence_stage_tasks
  SET stage_key   = 'payment_confirmation',
      stage_order = 17,
      title       = 'Confirm that the sponsor has paid the licence fee on the UKVI portal. Check the portal or obtain written confirmation from the sponsor.'
  WHERE stage_key = 'payment' AND role = 'caseworker';

UPDATE licence_stage_tasks
  SET stage_key   = 'payment_confirmation',
      stage_order = 17,
      title       = 'Record the UKVI payment confirmation and update the application accordingly.'
  WHERE stage_key = 'payment' AND role = 'admin';

-- Step C: Shift the eight middle stages (old 9-16 → new 8-15)
UPDATE licence_stage_tasks
  SET stage_order = stage_order - 1
  WHERE stage_key IN (
    'intake_information_form',
    'intake_document_checklist',
    'sponsor_information_provision',
    'government_sms_registration',
    'sponsor_portal_onboarding',
    'government_portal_credentials',
    'government_application_forms',
    'government_submission'
  );

-- Step D: Fix government_portal_credentials task text to reflect new flow
--  (UKVI sends credentials to sponsor email; sponsor submits them to caseworker/admin)
UPDATE licence_stage_tasks
  SET title = 'UKVI will send your portal credentials directly to your registered email. Once received, log in to this portal and submit your username and password to share them securely with your case team.'
  WHERE stage_key = 'government_portal_credentials' AND role = 'sponsor';

UPDATE licence_stage_tasks
  SET title = 'Review the UKVI portal credentials submitted by the sponsor. Confirm they are correct and record them for completing the UKVI application forms.'
  WHERE stage_key = 'government_portal_credentials' AND role = 'caseworker';

UPDATE licence_stage_tasks
  SET title = 'Confirm that the UKVI portal credentials have been received from the sponsor and are securely recorded in the system.'
  WHERE stage_key = 'government_portal_credentials' AND role = 'admin';
