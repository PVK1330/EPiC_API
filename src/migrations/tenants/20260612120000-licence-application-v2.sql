-- Sponsor Licence Application V2 — fully normalized 8-step structure.
--
-- Coexists with V1: the existing licence_applications row stays the parent (so the
-- review/audit/activation pipeline is reused), distinguished by application_version
-- (V1 = 1, V2 = 2). V2 section data lives in typed columns + dedicated child tables.
--
-- Idempotent: safe to run more than once.

-- 1) Status enum: add 'Draft' (PG 12+ allows ADD VALUE in the implicit tx; the value
--    is not used in this migration). IF NOT EXISTS makes it re-runnable.
ALTER TYPE "enum_licence_applications_status" ADD VALUE IF NOT EXISTS 'Draft';

-- 2) Parent table additions (V2 metadata + computed fee snapshot).
ALTER TABLE IF EXISTS "licence_applications"
  ADD COLUMN IF NOT EXISTS "application_version" SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "current_step"        SMALLINT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "submitted_at"        TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "fee_sponsor_size"    VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "fee_base"            NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS "fee_isc_estimate"    NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS "fee_total"           NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS "fee_currency"        VARCHAR(3) DEFAULT 'GBP';

-- Relax legacy NOT NULL columns so partial V2 drafts can be saved. On submit, a few
-- display fields are mirrored back from the section tables for the reviewer screens.
ALTER TABLE IF EXISTS "licence_applications" ALTER COLUMN "companyName"        DROP NOT NULL;
ALTER TABLE IF EXISTS "licence_applications" ALTER COLUMN "registrationNumber" DROP NOT NULL;
ALTER TABLE IF EXISTS "licence_applications" ALTER COLUMN "industry"           DROP NOT NULL;
ALTER TABLE IF EXISTS "licence_applications" ALTER COLUMN "licenceType"        DROP NOT NULL;
ALTER TABLE IF EXISTS "licence_applications" ALTER COLUMN "cosAllocation"      DROP NOT NULL;
ALTER TABLE IF EXISTS "licence_applications" ALTER COLUMN "contactName"        DROP NOT NULL;
ALTER TABLE IF EXISTS "licence_applications" ALTER COLUMN "contactEmail"       DROP NOT NULL;
ALTER TABLE IF EXISTS "licence_applications" ALTER COLUMN "contactPhone"       DROP NOT NULL;

-- 3) Child tables (FK -> licence_applications ON DELETE CASCADE). organisation_id is
--    the tenant scope (mirrors worker_events). 1:1 tables UNIQUE on application id.

-- Step 1 — Licence routes (multi-select)
CREATE TABLE IF NOT EXISTS "licence_application_routes" (
  "id" SERIAL PRIMARY KEY,
  "licence_application_id" INTEGER NOT NULL REFERENCES "licence_applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "route_code" VARCHAR(30) NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "uq_licence_route" UNIQUE ("licence_application_id", "route_code")
);
CREATE INDEX IF NOT EXISTS "idx_licence_routes_app" ON "licence_application_routes" ("licence_application_id");

-- Step 2 — Organisation information (1:1)
CREATE TABLE IF NOT EXISTS "licence_organisation_info" (
  "id" SERIAL PRIMARY KEY,
  "licence_application_id" INTEGER NOT NULL UNIQUE REFERENCES "licence_applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "organisation_type" VARCHAR(100),
  "companies_house_number" VARCHAR(20),
  "paye_reference" VARCHAR(50),
  "accounts_office_reference" VARCHAR(50),
  "vat_number" VARCHAR(30),
  "charity_status" BOOLEAN DEFAULT FALSE,
  "charity_number" VARCHAR(30),
  "trading_start_date" DATE,
  "sic_codes" TEXT[],
  "regions" TEXT[],
  "accreditations" TEXT[],
  "previous_trading_names" TEXT[],
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Step 3 — Structured CoS requirements (1:N)
CREATE TABLE IF NOT EXISTS "licence_cos_requirements" (
  "id" SERIAL PRIMARY KEY,
  "licence_application_id" INTEGER NOT NULL REFERENCES "licence_applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "soc_code" VARCHAR(10),
  "role_title" VARCHAR(255),
  "salary" NUMERIC(12, 2),
  "salary_currency" VARCHAR(3) DEFAULT 'GBP',
  "candidate_name" VARCHAR(255),
  "candidate_nationality" VARCHAR(100),
  "candidate_dob" DATE,
  "candidate_email" VARCHAR(255),
  "sponsorship_duration_months" SMALLINT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_licence_cos_req_app" ON "licence_cos_requirements" ("licence_application_id");

-- Step 4 — Appendix A document checklist (1:N, reviewer tracks received/verification)
CREATE TABLE IF NOT EXISTS "licence_appendix_documents" (
  "id" SERIAL PRIMARY KEY,
  "licence_application_id" INTEGER NOT NULL REFERENCES "licence_applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "document_key" VARCHAR(80) NOT NULL,
  "document_name" VARCHAR(255) NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT TRUE,
  "file_path" VARCHAR(500),
  "received_status" VARCHAR(20) NOT NULL DEFAULT 'Not Received',
  "verification_status" VARCHAR(20) NOT NULL DEFAULT 'Pending',
  "verified_by" INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "verified_at" TIMESTAMP WITH TIME ZONE,
  "notes" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_licence_appendix_app" ON "licence_appendix_documents" ("licence_application_id");

-- Step 5 — Authorising officer (1:1)
CREATE TABLE IF NOT EXISTS "licence_authorising_officer" (
  "id" SERIAL PRIMARY KEY,
  "licence_application_id" INTEGER NOT NULL UNIQUE REFERENCES "licence_applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "title" VARCHAR(20),
  "first_name" VARCHAR(120),
  "last_name" VARCHAR(120),
  "dob" DATE,
  "nationality" VARCHAR(100),
  "ni_number" VARCHAR(20),
  "immigration_status" VARCHAR(100),
  "has_convictions" BOOLEAN DEFAULT FALSE,
  "convictions_details" TEXT,
  "email" VARCHAR(255),
  "phone" VARCHAR(30),
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Step 6 — Key contact (1:1)
CREATE TABLE IF NOT EXISTS "licence_key_contact" (
  "id" SERIAL PRIMARY KEY,
  "licence_application_id" INTEGER NOT NULL UNIQUE REFERENCES "licence_applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "same_as_authorising_officer" BOOLEAN DEFAULT FALSE,
  "title" VARCHAR(20),
  "first_name" VARCHAR(120),
  "last_name" VARCHAR(120),
  "email" VARCHAR(255),
  "phone" VARCHAR(30),
  "job_title" VARCHAR(150),
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Step 7 — Level 1 users (1:N)
CREATE TABLE IF NOT EXISTS "licence_level1_users" (
  "id" SERIAL PRIMARY KEY,
  "licence_application_id" INTEGER NOT NULL REFERENCES "licence_applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "first_name" VARCHAR(120),
  "last_name" VARCHAR(120),
  "email" VARCHAR(255),
  "phone" VARCHAR(30),
  "job_title" VARCHAR(150),
  "is_authorising_officer" BOOLEAN DEFAULT FALSE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_licence_l1_app" ON "licence_level1_users" ("licence_application_id");

-- Step 8 — Declarations (1:1)
CREATE TABLE IF NOT EXISTS "licence_declarations" (
  "id" SERIAL PRIMARY KEY,
  "licence_application_id" INTEGER NOT NULL UNIQUE REFERENCES "licence_applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "accuracy_confirmed" BOOLEAN DEFAULT FALSE,
  "duties_understood" BOOLEAN DEFAULT FALSE,
  "data_consent" BOOLEAN DEFAULT FALSE,
  "signatory_name" VARCHAR(255),
  "signatory_role" VARCHAR(150),
  "signed_date" DATE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
