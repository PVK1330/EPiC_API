-- Compliance Document review workflow
-- Migration: 20260610120000-compliance-document-review-workflow.sql
--
-- 1) Extend enum_compliance_documents_status with the review-workflow states.
-- 2) Add reviewer decision columns (reviewed_at, review_notes).
-- 3) Create the immutable compliance_document_audits trail table.
--
-- NOTE: requires PostgreSQL 12+ (ALTER TYPE ... ADD VALUE inside a transaction).
-- The new enum values are NOT consumed in this migration (the column DEFAULT is
-- left as 'under_review'); the application model supplies 'submitted' on insert,
-- so there is no "unsafe use of new value" within this transaction.

-- 1) Add workflow values to the status enum (idempotent). 'under_review' already exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'draft'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'enum_compliance_documents_status')) THEN
    ALTER TYPE enum_compliance_documents_status ADD VALUE 'draft';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'submitted'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'enum_compliance_documents_status')) THEN
    ALTER TYPE enum_compliance_documents_status ADD VALUE 'submitted';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'approved'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'enum_compliance_documents_status')) THEN
    ALTER TYPE enum_compliance_documents_status ADD VALUE 'approved';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'rejected'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'enum_compliance_documents_status')) THEN
    ALTER TYPE enum_compliance_documents_status ADD VALUE 'rejected';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'information_requested'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'enum_compliance_documents_status')) THEN
    ALTER TYPE enum_compliance_documents_status ADD VALUE 'information_requested';
  END IF;
END $$;

-- 2) Reviewer decision metadata on the document.
ALTER TABLE "compliance_documents"
  ADD COLUMN IF NOT EXISTS "reviewed_at"  TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "review_notes" TEXT;

-- 3) Immutable status-change audit trail (one row per transition).
CREATE TABLE IF NOT EXISTS "compliance_document_audits" (
  "id" SERIAL PRIMARY KEY,
  "compliance_document_id" INTEGER NOT NULL REFERENCES "compliance_documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "reviewer_id" INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "action" VARCHAR(50) NOT NULL,
  "previous_status" VARCHAR(50),
  "new_status" VARCHAR(50) NOT NULL,
  "notes" TEXT,
  "reviewed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_document_audits_doc
  ON "compliance_document_audits" ("compliance_document_id");
CREATE INDEX IF NOT EXISTS idx_compliance_document_audits_reviewer
  ON "compliance_document_audits" ("reviewer_id");
