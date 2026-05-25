DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_compliance_documents_status') THEN
    CREATE TYPE enum_compliance_documents_status AS ENUM ('valid', 'expired', 'missing', 'under_review');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "compliance_documents" (
  "id" SERIAL PRIMARY KEY,
  "sponsor_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "document_type" VARCHAR(255) NOT NULL,
  "document_path" VARCHAR(500) NOT NULL,
  "upload_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "expiry_date" DATE,
  "last_reviewed_date" DATE,
  "reviewed_by" INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "status" enum_compliance_documents_status NOT NULL DEFAULT 'under_review',
  "notes" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
