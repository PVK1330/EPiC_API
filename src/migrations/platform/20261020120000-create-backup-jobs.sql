-- Database backup / restore job registry (platform DB).
-- Idempotent. file_path is a server-side temp path and is never returned to clients.
CREATE TABLE IF NOT EXISTS backup_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind VARCHAR(20) NOT NULL,
  scope VARCHAR(20) NOT NULL,
  organisation_id INTEGER NULL,
  database_name VARCHAR(63) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  stage VARCHAR(50) NULL,
  file_path TEXT NULL,
  file_name VARCHAR(255) NULL,
  file_size BIGINT NULL,
  checksum VARCHAR(64) NULL,
  error TEXT NULL,
  meta JSONB NULL,
  requested_by INTEGER NULL,
  requested_by_role INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NULL,
  CONSTRAINT backup_jobs_kind_chk CHECK (kind IN ('backup','restore')),
  CONSTRAINT backup_jobs_scope_chk CHECK (scope IN ('organisation','platform','all')),
  CONSTRAINT backup_jobs_status_chk CHECK (status IN ('pending','running','completed','failed','expired'))
);

CREATE INDEX IF NOT EXISTS idx_backup_jobs_org_kind_status_completed
  ON backup_jobs (organisation_id, kind, status, completed_at);
CREATE INDEX IF NOT EXISTS idx_backup_jobs_status_expires
  ON backup_jobs (status, expires_at);
