DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_absence_records_absence_type') THEN
    CREATE TYPE enum_absence_records_absence_type AS ENUM ('annual_leave', 'sick_leave', 'unauthorised', 'other');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "absence_records" (
  "id" SERIAL PRIMARY KEY,
  "worker_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sponsor_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "absence_type" enum_absence_records_absence_type NOT NULL,
  "start_date" DATE NOT NULL,
  "end_date" DATE NOT NULL,
  "total_working_days" INTEGER NOT NULL DEFAULT 0,
  "attendance_record_path" VARCHAR(500),
  "reported_to_sms" BOOLEAN NOT NULL DEFAULT false,
  "reporting_required" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION fn_set_absence_reporting_required()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.total_working_days > 10 THEN
    NEW.reporting_required := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_absence_reporting_required ON "absence_records";

CREATE TRIGGER trg_set_absence_reporting_required
BEFORE INSERT OR UPDATE ON "absence_records"
FOR EACH ROW EXECUTE FUNCTION fn_set_absence_reporting_required();
