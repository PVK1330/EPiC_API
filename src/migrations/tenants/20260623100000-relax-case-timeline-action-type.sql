-- The case_timeline.action_type CHECK constraint was a fixed allow-list of 15
-- values that drifted badly from the application. The workflow records ~90
-- distinct action types via recordTimelineEntry() — biometric_attended,
-- biometric_slot_sent, biometric_availability, application_submitted,
-- documents_uploaded, ccl_fee_approved, licence_*, intake_*, government_*, …
-- recordTimelineEntry() swallows DB errors, so every entry whose action_type was
-- absent from the list was SILENTLY dropped. For example the public timeline
-- entry "Candidate confirmed biometrics attendance" never reached the case
-- timeline, so neither the candidate nor the caseworker could see it.
--
-- action_type is set from application constants (never user input), so the
-- DB-level allow-list provided no real safety while causing silent audit-log
-- data loss. Drop it: the column stays VARCHAR(50) and the application remains
-- the single source of truth for action types.

ALTER TABLE IF EXISTS "case_timeline"
  DROP CONSTRAINT IF EXISTS "case_timeline_action_type_check";
