DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_sponsor_change_requests_change_type') THEN
    CREATE TYPE enum_sponsor_change_requests_change_type AS ENUM ('company_address', 'ownership', 'merger_acquisition', 'key_personnel', 'insolvency_risk', 'trading_status');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_sponsor_change_requests_status') THEN
    CREATE TYPE enum_sponsor_change_requests_status AS ENUM ('pending', 'submitted', 'overdue');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "sponsor_change_requests" (
  "id" SERIAL PRIMARY KEY,
  "sponsor_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "change_type" enum_sponsor_change_requests_change_type NOT NULL,
  "description" TEXT,
  "requested_by" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "status" enum_sponsor_change_requests_status NOT NULL DEFAULT 'pending',
  "event_date" TIMESTAMP WITH TIME ZONE NOT NULL,
  "reporting_deadline" TIMESTAMP WITH TIME ZONE NOT NULL,
  "date_reported" TIMESTAMP WITH TIME ZONE,
  "reported_by" INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "evidence_file" VARCHAR(500),
  "notes" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
