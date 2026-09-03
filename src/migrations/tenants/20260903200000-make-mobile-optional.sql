-- BUG-015: a mobile number is optional (sponsors may have none). Allow NULL and
-- make the uniqueness constraint partial so multiple users can have no mobile
-- while a real (country_code, mobile) pair stays unique.
ALTER TABLE users ALTER COLUMN mobile DROP NOT NULL;

DROP INDEX IF EXISTS idx_users_mobile_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_mobile_unique
  ON users (country_code, mobile)
  WHERE mobile IS NOT NULL AND mobile <> '';
