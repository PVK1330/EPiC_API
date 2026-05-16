-- Physical tenant database name (nullable; shared-catalog orgs have NULL)
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "database_name" VARCHAR(63);
