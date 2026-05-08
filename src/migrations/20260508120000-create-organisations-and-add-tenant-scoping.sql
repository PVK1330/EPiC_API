-- Create Organisation Plan and Status Enums if they don't exist
DO $$ BEGIN
    CREATE TYPE "enum_organisations_plan" AS ENUM('starter', 'pro', 'enterprise');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "enum_organisations_status" AS ENUM('active', 'trial', 'suspended');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 1. Create Organisations Table
CREATE TABLE IF NOT EXISTS "organisations" (
    "id" SERIAL PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL UNIQUE,
    "plan" "enum_organisations_plan" DEFAULT 'starter' NOT NULL,
    "status" "enum_organisations_status" DEFAULT 'trial' NOT NULL,
    "primaryEmail" VARCHAR(255) NOT NULL,
    "country" VARCHAR(100),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
);

-- 2. Add organisation_id to Users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations"("id") ON UPDATE CASCADE ON DELETE SET NULL;

-- 3. Add organisation_id to Cases
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations"("id") ON UPDATE CASCADE ON DELETE SET NULL;

-- 4. Add organisation_id to Sponsor Profiles
ALTER TABLE "sponsor_profiles" ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations"("id") ON UPDATE CASCADE ON DELETE SET NULL;

-- 5. Add organisation_id to Candidate Applications
ALTER TABLE "candidate_applications" ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations"("id") ON UPDATE CASCADE ON DELETE SET NULL;

-- 6. Add organisation_id and audit fields to Audit Logs
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations"("id") ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "old_value" JSONB;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "new_value" JSONB;
