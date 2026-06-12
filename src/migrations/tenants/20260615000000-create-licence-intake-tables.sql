-- Phase 1 (C-1): Create licence intake form and document tables.
--
-- These tables back the Sponsor Information Form (12 fields) collected during
-- the intake stage and the Document Checklist that gates Government Registration.
-- The intake form is 1:1 with a licence application; the document rows are 1:M.
--
-- Sequelize ENUM convention: enum_{tableName}_{columnName}

-- ── ENUM types ────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'enum_licence_intake_documents_category'
  ) THEN
    CREATE TYPE "enum_licence_intake_documents_category" AS ENUM (
      'mandatory',
      'conditional'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'enum_licence_intake_documents_status'
  ) THEN
    CREATE TYPE "enum_licence_intake_documents_status" AS ENUM (
      'pending',
      'uploaded',
      'verified',
      'rejected',
      'information_required'
    );
  END IF;
END$$;

-- ── 1. Intake information form (1:1 with licence_applications) ─────────────────

CREATE TABLE IF NOT EXISTS "licence_intake_forms" (
  "id"                                  SERIAL PRIMARY KEY,

  "licence_application_id"              INTEGER NOT NULL
                                          REFERENCES "licence_applications" ("id")
                                          ON DELETE CASCADE
                                          ON UPDATE CASCADE,

  "organisation_id"                     INTEGER NOT NULL,

  -- 12 information form fields
  "trading_name"                        VARCHAR(255),
  "premises_address"                    JSONB,
  "owning_limited_company"              VARCHAR(255),
  "named_person_on_licence"             VARCHAR(255),
  "phone_number"                        VARCHAR(30),
  "ni_number"                           VARCHAR(20),
  "email_address"                       VARCHAR(255),
  "job_titles_required"                 JSONB NOT NULL DEFAULT '[]',
  "company_website"                     VARCHAR(500),
  "total_employees"                     INTEGER,
  "employees_under_immigration_rules"   INTEGER,
  "number_of_cos_required"              INTEGER,

  -- conditional document trigger flags
  "conditions"                          JSONB NOT NULL DEFAULT
    '{"foodBusiness":false,"alcoholBusiness":false,"careBusiness":false,"tupeTransfer":false,"candidateIdentified":false,"candidateNotIdentified":false}',

  -- completion state
  "is_complete"                         BOOLEAN NOT NULL DEFAULT FALSE,
  "submitted_at"                        TIMESTAMP WITH TIME ZONE,
  "submitted_by_user_id"                INTEGER,
  "last_updated_by_user_id"             INTEGER,

  "created_at"                          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at"                          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_intake_form_application"
  ON "licence_intake_forms" ("licence_application_id");

CREATE INDEX IF NOT EXISTS "idx_intake_form_organisation"
  ON "licence_intake_forms" ("organisation_id");

COMMENT ON TABLE "licence_intake_forms"
  IS 'Sponsor information form (12 fields) for the licence intake stage. One row per licence application.';

COMMENT ON COLUMN "licence_intake_forms"."conditions"
  IS 'Boolean flags that trigger conditional document requirements: foodBusiness, alcoholBusiness, careBusiness, tupeTransfer, candidateIdentified, candidateNotIdentified.';

-- ── 2. Document checklist (1:M with licence_applications) ─────────────────────

CREATE TABLE IF NOT EXISTS "licence_intake_documents" (
  "id"                      SERIAL PRIMARY KEY,

  "licence_application_id"  INTEGER NOT NULL
                              REFERENCES "licence_applications" ("id")
                              ON DELETE CASCADE
                              ON UPDATE CASCADE,

  "organisation_id"         INTEGER NOT NULL,

  -- document identity
  "document_key"            VARCHAR(100)  NOT NULL,
  "document_name"           VARCHAR(500)  NOT NULL,
  "category"                "enum_licence_intake_documents_category" NOT NULL DEFAULT 'mandatory',
  "condition_type"          VARCHAR(50),
  "is_required"             BOOLEAN       NOT NULL DEFAULT TRUE,
  "sort_order"              INTEGER       NOT NULL DEFAULT 0,

  -- workflow status
  "status"                  "enum_licence_intake_documents_status"  NOT NULL DEFAULT 'pending',

  -- uploaded file metadata
  "file_name"               VARCHAR(500),
  "file_path"               TEXT,
  "file_mime_type"          VARCHAR(100),
  "file_size_bytes"         INTEGER,
  "uploaded_at"             TIMESTAMP WITH TIME ZONE,
  "uploaded_by_user_id"     INTEGER,

  -- caseworker review
  "verified_at"             TIMESTAMP WITH TIME ZONE,
  "verified_by_user_id"     INTEGER,
  "rejection_reason"        TEXT,
  "caseworker_notes"        TEXT,

  "created_at"              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at"              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_intake_doc_application"
  ON "licence_intake_documents" ("licence_application_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_intake_doc_application_key"
  ON "licence_intake_documents" ("licence_application_id", "document_key");

CREATE INDEX IF NOT EXISTS "idx_intake_doc_organisation"
  ON "licence_intake_documents" ("organisation_id");

CREATE INDEX IF NOT EXISTS "idx_intake_doc_status"
  ON "licence_intake_documents" ("status");

COMMENT ON TABLE "licence_intake_documents"
  IS 'Checklist of mandatory and conditional documents for the licence intake stage. Mandatory rows are seeded on form creation; conditional rows are added when the matching conditions flag is set.';

COMMENT ON COLUMN "licence_intake_documents"."document_key"
  IS 'Stable identifier (slug) for the document type, e.g. employer_liability_insurance. Must be unique per application.';
