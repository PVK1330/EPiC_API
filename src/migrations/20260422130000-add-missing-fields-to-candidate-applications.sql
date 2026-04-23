-- Migration: add firstName, lastName, email, contactNumber to candidate_applications
-- Also converts gender from a PostgreSQL ENUM type to VARCHAR(30) to accept
-- all values sent by the frontend form (Male / Female / Other / Prefer not to say).

-- 1. Add the four identity fields that were missing from the original table.
--    IF NOT EXISTS guards make this re-runnable without errors.

ALTER TABLE candidate_applications
  ADD COLUMN IF NOT EXISTS "firstName"      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "lastName"       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "email"          VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "contactNumber"  VARCHAR(50);

-- 2. Convert the gender column from ENUM to VARCHAR so every frontend option
--    (Male, Female, Other, Prefer not to say) is accepted without a constraint error.
--    We cast via ::text first because PostgreSQL will not implicitly cast an enum to varchar.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_applications'
      AND column_name = 'gender'
      AND data_type = 'USER-DEFINED'   -- PostgreSQL represents enum as USER-DEFINED
  ) THEN
    ALTER TABLE candidate_applications
      ALTER COLUMN gender TYPE VARCHAR(30) USING gender::text;
  END IF;
END $$;
