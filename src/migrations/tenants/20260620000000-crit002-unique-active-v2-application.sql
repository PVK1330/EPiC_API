-- Migration: CRIT-002 — Prevent duplicate active V2 licence applications per sponsor
--
-- Adds a partial unique index on licence_applications so that a sponsor
-- (user_id) can only have ONE non-terminal, non-draft V2 application at a time.
-- This closes the TOCTOU race window in createDraft() where two concurrent
-- POST requests could both pass the findOne check and both insert a new row.
--
-- The index is partial (WHERE clause) so that:
--   - Multiple Draft applications are still allowed (sponsors can save multiple
--     incomplete drafts — only one active "live" application is blocked).
--   - Rejected / Licence Granted / Licence Rejected applications do not block
--     a new application (re-apply path).
--   - Soft-deleted rows (deleted_at IS NOT NULL) are excluded.
--
-- Active statuses covered by the uniqueness constraint:
--   Pending, Under Review, Information Requested, Government Processing,
--   Decision Pending
--
-- Statuses NOT covered (intentionally excluded):
--   Draft, Approved, Rejected, Licence Granted, Licence Rejected
--
-- When createDraft() tries to insert a second active application inside a
-- SERIALIZABLE transaction, this index raises a UniqueConstraintError which
-- the service catches and re-throws as HTTP 409 DUPLICATE_ACTIVE_APPLICATION.

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_v2_application_per_user
  ON licence_applications (user_id)
  WHERE
    application_version = 2
    AND status NOT IN ('Draft', 'Approved', 'Rejected', 'Licence Granted', 'Licence Rejected')
    AND deleted_at IS NULL;
