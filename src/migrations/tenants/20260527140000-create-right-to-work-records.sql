DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_right_to_work_records_status') THEN
    CREATE TYPE enum_right_to_work_records_status AS ENUM ('valid', 'expired', 'pending_followup');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "right_to_work_records" (
  "id" SERIAL PRIMARY KEY,
  "worker_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sponsor_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "initial_check_date" DATE NOT NULL,
  "checked_by" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "reference_number" VARCHAR(255),
  "document_path" VARCHAR(500),
  "follow_up_check_date" DATE,
  "status" enum_right_to_work_records_status NOT NULL DEFAULT 'valid',
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
