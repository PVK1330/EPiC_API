-- Platform registry database (superadmin / login / organisation routing)
-- Safe to re-run (IF NOT EXISTS).

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS database_name VARCHAR(63);

CREATE INDEX IF NOT EXISTS idx_organisations_slug ON organisations (slug);
CREATE INDEX IF NOT EXISTS idx_organisations_status ON organisations (status);

CREATE INDEX IF NOT EXISTS idx_users_organisation_id ON users (organisation_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
