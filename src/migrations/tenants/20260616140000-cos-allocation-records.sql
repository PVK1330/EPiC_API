-- Migration: CoS Allocation Records
-- Creates an immutable allocation record each time a CoS request is approved.
-- The record is the canonical source of truth for: allocation number, visa type,
-- allocated amount, expiry (tied to the sponsor licence), and reviewer.
-- Worker-level CoS consumption is tracked separately (Phase 5).

CREATE TABLE IF NOT EXISTS cos_allocation_records (
  id                 SERIAL PRIMARY KEY,
  cos_request_id     INTEGER NOT NULL UNIQUE
                       REFERENCES cos_requests(id) ON DELETE CASCADE,
  sponsor_id         INTEGER NOT NULL
                       REFERENCES users(id) ON DELETE CASCADE,
  organisation_id    INTEGER REFERENCES organisations(id) ON DELETE SET NULL,
  allocation_number  VARCHAR(50) NOT NULL UNIQUE,
  visa_type          VARCHAR(100),
  allocated_amount   INTEGER NOT NULL,
  allocated_by_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  allocated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expiry_date        TIMESTAMPTZ,
  -- 'Active' is the only state until Phase 5 (worker management) adds Used/Expired/Revoked.
  status             VARCHAR(20) NOT NULL DEFAULT 'Active',
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_car_cos_request  ON cos_allocation_records (cos_request_id);
CREATE INDEX IF NOT EXISTS idx_car_sponsor       ON cos_allocation_records (sponsor_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_car_number ON cos_allocation_records (allocation_number);
