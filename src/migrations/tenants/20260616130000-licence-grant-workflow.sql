-- Migration: Licence Grant Workflow
-- Adds 'Licence Granted' and 'Licence Rejected' as formal terminal statuses,
-- stores rejection reasons directly on the application row, and creates a
-- licence_grant_records table that is the canonical source of truth for the
-- granted licence number, approval date, expiry, and CoS allocation.

-- 1. Expand the application status ENUM.
--    PostgreSQL requires ALTER TYPE ... ADD VALUE to run outside a transaction;
--    IF NOT EXISTS prevents errors on re-run.
ALTER TYPE enum_licence_applications_status ADD VALUE IF NOT EXISTS 'Licence Granted';
ALTER TYPE enum_licence_applications_status ADD VALUE IF NOT EXISTS 'Licence Rejected';

-- 2. Store the rejection reason on the application itself for fast access.
ALTER TABLE licence_applications
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- 3. Grant record — one row per approved application.
--    Created atomically alongside the status update so the two are always in sync.
CREATE TABLE IF NOT EXISTS licence_grant_records (
  id                     SERIAL PRIMARY KEY,
  licence_application_id INTEGER NOT NULL UNIQUE
                           REFERENCES licence_applications(id) ON DELETE CASCADE,
  licence_number         VARCHAR(100) NOT NULL,
  approved_by_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  grant_date             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expiry_date            TIMESTAMPTZ,
  sponsor_type           VARCHAR(100),
  rating                 VARCHAR(10)  NOT NULL DEFAULT 'A',
  cos_allocation         INTEGER,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lgr_application ON licence_grant_records (licence_application_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lgr_licence_number ON licence_grant_records (licence_number);
