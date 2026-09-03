-- BUG-015 (platform registry): mirror the tenant change — mobile is optional and
-- the uniqueness constraint is partial so multiple users may have no mobile.
ALTER TABLE users ALTER COLUMN mobile DROP NOT NULL;

DROP INDEX IF EXISTS idx_users_mobile_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_mobile_unique
  ON users (country_code, mobile)
  WHERE mobile IS NOT NULL AND mobile <> '';
