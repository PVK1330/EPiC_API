-- Soft-delete support for organisations (Superadmin list / recreate after delete)
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_organisations_deleted_at ON organisations (deleted_at);
