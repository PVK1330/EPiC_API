-- Migration: 20260619000000-add-status-check-constraints.sql
-- Fixes ISSUE-010, ISSUE-017, ISSUE-018
--
-- ISSUE-010: sponsored_workers.status has no DB-level guard — any string can be
--            written directly, bypassing the FSM.  Add a CHECK constraint whose
--            allowed values match WORKER_TRANSITIONS in workflowEngine.service.js.
--
-- ISSUE-017: cos_requests.status has no DB-level guard.  Same fix — allowed
--            values match COS_REQUEST_TRANSITIONS in workflowEngine.service.js.
--            NOTE: the requirements spec listed 5 values (Pending … Allocated).
--            The FSM also allows Used / Expired / Revoked as terminal states
--            reachable from Allocated — those are included here so the constraint
--            does not break the Allocated → {Used|Expired|Revoked} transitions.
--
-- ISSUE-018: The audit noted 'Draft' as absent from PostgreSQL ENUM migrations.
--            20260612120000-licence-application-v2.sql already adds 'Draft'
--            (line 11: ALTER TYPE … ADD VALUE IF NOT EXISTS 'Draft').
--            However 'Government Processing', 'Decision Pending', and 'Expired'
--            are present in the Sequelize model ENUM and the FSM but absent from
--            all existing migrations — the same class of bug.  This migration
--            adds them. All ADD VALUE statements use IF NOT EXISTS so the file is
--            idempotent and safe to re-run.
--
-- Idempotency: CHECK constraints use a DO $$ block that skips the ADD if the
--              constraint already exists, matching the project convention.
--              ENUM ADD VALUE uses IF NOT EXISTS (PostgreSQL 9.3+).
--
-- Rollback: see the DOWN section at the bottom of this file.

-- ═══════════════════════════════════════════════════════════════════════════════
-- PRE-FLIGHT — run these queries manually before applying; zero rows expected.
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Rows that would violate the sponsored_workers CHECK:
--   SELECT id, status FROM sponsored_workers
--   WHERE status NOT IN (
--     'CoS Assigned','Immigration Assessment','Visa Preparation',
--     'Compliance Review','Visa Decision','Visa Granted','Visa Rejected'
--   );
--
-- Rows that would violate the cos_requests CHECK:
--   SELECT id, status FROM cos_requests
--   WHERE status NOT IN (
--     'Pending','Under Review','Approved','Rejected',
--     'Allocated','Used','Expired','Revoked'
--   );


-- ═══════════════════════════════════════════════════════════════════════════════
-- UP
-- ═══════════════════════════════════════════════════════════════════════════════


-- ── ISSUE-010: sponsored_workers.status CHECK ─────────────────────────────────
-- Valid states derived from WORKER_TRANSITIONS in workflowEngine.service.js:
--   CoS Assigned → Immigration Assessment | Visa Rejected
--   Immigration Assessment → Visa Preparation | Visa Rejected
--   Visa Preparation → Compliance Review | Visa Rejected
--   Compliance Review → Visa Decision | Visa Rejected
--   Visa Decision → Visa Granted | Visa Rejected
--   Visa Granted → (terminal)
--   Visa Rejected → (terminal)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname    = 'sponsored_workers_status_check'
    AND    conrelid   = 'sponsored_workers'::regclass
  ) THEN
    ALTER TABLE sponsored_workers
      ADD CONSTRAINT sponsored_workers_status_check
      CHECK (status IN (
        'CoS Assigned',
        'Immigration Assessment',
        'Visa Preparation',
        'Compliance Review',
        'Visa Decision',
        'Visa Granted',
        'Visa Rejected'
      ));
  END IF;
END;
$$;


-- ── ISSUE-017: cos_requests.status CHECK ─────────────────────────────────────
-- Valid states derived from COS_REQUEST_TRANSITIONS in workflowEngine.service.js:
--   Pending → Under Review | Approved | Rejected
--   Under Review → Approved | Rejected
--   Approved → Allocated
--   Allocated → Used | Expired | Revoked
--   Used → (terminal)
--   Expired → (terminal)
--   Revoked → (terminal)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname    = 'cos_requests_status_check'
    AND    conrelid   = 'cos_requests'::regclass
  ) THEN
    ALTER TABLE cos_requests
      ADD CONSTRAINT cos_requests_status_check
      CHECK (status IN (
        'Pending',
        'Under Review',
        'Approved',
        'Rejected',
        'Allocated',
        'Used',
        'Expired',
        'Revoked'
      ));
  END IF;
END;
$$;


-- ── ISSUE-018: licence_applications.status ENUM completeness ─────────────────
-- 'Draft' was already added by 20260612120000-licence-application-v2.sql.
-- 'Licence Granted' and 'Licence Rejected' were added by 20260616130000.
--
-- The following values are present in the Sequelize model ENUM and the
-- LICENCE_TRANSITIONS FSM but are absent from all existing migrations:
--   Government Processing  (reachable from Under Review)
--   Decision Pending       (reachable from Government Processing)
--   Expired                (terminal; reachable from Approved and Licence Granted)
--
-- All three are added here. IF NOT EXISTS makes each statement idempotent.
-- PostgreSQL 12+ allows ADD VALUE inside a transaction; 9.3–11 requires that
-- the statement run outside a transaction block.

ALTER TYPE "enum_licence_applications_status" ADD VALUE IF NOT EXISTS 'Government Processing';
ALTER TYPE "enum_licence_applications_status" ADD VALUE IF NOT EXISTS 'Decision Pending';
ALTER TYPE "enum_licence_applications_status" ADD VALUE IF NOT EXISTS 'Expired';


-- ═══════════════════════════════════════════════════════════════════════════════
-- DOWN (rollback)
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- CHECK constraints are straightforward to drop:
--
--   ALTER TABLE sponsored_workers
--     DROP CONSTRAINT IF EXISTS sponsored_workers_status_check;
--
--   ALTER TABLE cos_requests
--     DROP CONSTRAINT IF EXISTS cos_requests_status_check;
--
-- ENUM values cannot be removed in PostgreSQL without recreating the type.
-- If a rollback of the three ADD VALUE statements is required, follow the
-- procedure below.  WARNING: any rows whose status is one of the removed
-- values must be migrated first or the column ALTER will fail.
--
--   -- Step 1: migrate or delete rows with the values being removed
--   UPDATE licence_applications
--     SET status = 'Pending'
--     WHERE status IN ('Government Processing','Decision Pending','Expired');
--
--   -- Step 2: create a replacement type without the unwanted values
--   CREATE TYPE "enum_licence_applications_status_v2" AS ENUM (
--     'Draft',
--     'Pending',
--     'Approved',
--     'Rejected',
--     'Under Review',
--     'Information Requested',
--     'Licence Granted',
--     'Licence Rejected'
--   );
--
--   -- Step 3: swap the column to the new type
--   ALTER TABLE licence_applications
--     ALTER COLUMN status TYPE "enum_licence_applications_status_v2"
--     USING status::text::"enum_licence_applications_status_v2";
--
--   -- Step 4: replace the old type
--   DROP TYPE "enum_licence_applications_status";
--   ALTER TYPE "enum_licence_applications_status_v2"
--     RENAME TO "enum_licence_applications_status";
