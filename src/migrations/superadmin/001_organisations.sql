-- Platform registry: organisations table only (no tenant business tables on this DB).
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

CREATE TABLE IF NOT EXISTS "organisations" (
    "id" SERIAL PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL UNIQUE,
    "plan" "enum_organisations_plan" DEFAULT 'starter' NOT NULL,
    "status" "enum_organisations_status" DEFAULT 'trial' NOT NULL,
    "primaryEmail" VARCHAR(255) NOT NULL,
    "country" VARCHAR(100),
    "database_name" VARCHAR(63),
    "plan_id" INTEGER,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations"("id")
  ON UPDATE CASCADE ON DELETE SET NULL;
