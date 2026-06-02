-- Add login tracking columns missing from the initial users table
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "last_login"             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "failed_login_attempts"  INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "locked_until"           TIMESTAMPTZ;
