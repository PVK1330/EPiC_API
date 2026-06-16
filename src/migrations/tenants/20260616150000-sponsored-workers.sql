-- Phase 5: Sponsored Worker Management
-- Creates the sponsored_workers table (one row per CoS-assigned worker)
-- and the sponsored_worker_audits table (immutable audit trail).

CREATE TABLE IF NOT EXISTS sponsored_workers (
    id                      SERIAL PRIMARY KEY,
    cos_request_id          INTEGER REFERENCES cos_requests(id) ON DELETE SET NULL,
    cos_allocation_record_id INTEGER REFERENCES cos_allocation_records(id) ON DELETE SET NULL,
    sponsor_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organisation_id         INTEGER REFERENCES organisations(id) ON DELETE SET NULL,
    -- Worker personal details
    worker_first_name       VARCHAR(100) NOT NULL,
    worker_last_name        VARCHAR(100) NOT NULL,
    worker_email            VARCHAR(255),
    worker_nationality      VARCHAR(100),
    visa_type               VARCHAR(100),
    -- Workflow
    status                  VARCHAR(60) NOT NULL DEFAULT 'CoS Assigned',
    assigned_caseworker_ids JSONB,
    rejection_reason        TEXT,
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sponsored_workers_sponsor_id
    ON sponsored_workers(sponsor_id);

CREATE INDEX IF NOT EXISTS idx_sponsored_workers_cos_request_id
    ON sponsored_workers(cos_request_id);

CREATE INDEX IF NOT EXISTS idx_sponsored_workers_status
    ON sponsored_workers(status);

-- Immutable audit trail — one row per status change.
CREATE TABLE IF NOT EXISTS sponsored_worker_audits (
    id                   SERIAL PRIMARY KEY,
    sponsored_worker_id  INTEGER NOT NULL REFERENCES sponsored_workers(id) ON DELETE CASCADE,
    action               VARCHAR(60) NOT NULL,
    from_status          VARCHAR(60),
    to_status            VARCHAR(60) NOT NULL,
    actor_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,
    notes                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sponsored_worker_audits_worker_id
    ON sponsored_worker_audits(sponsored_worker_id);
