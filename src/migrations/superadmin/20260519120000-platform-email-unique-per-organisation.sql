-- Multi-tenant: same email may exist in different organisations.
-- Uniqueness is (email + organisation_id); platform/superadmin rows use organisation_id IS NULL.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

DROP INDEX IF EXISTS idx_users_email_org_unique;
DROP INDEX IF EXISTS idx_users_email_no_org_unique;

CREATE UNIQUE INDEX idx_users_email_org_unique
  ON users (LOWER(TRIM(email)), organisation_id)
  WHERE organisation_id IS NOT NULL;

CREATE UNIQUE INDEX idx_users_email_no_org_unique
  ON users (LOWER(TRIM(email)))
  WHERE organisation_id IS NULL;
