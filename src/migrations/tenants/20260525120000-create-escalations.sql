DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_escalations_severity') THEN
    CREATE TYPE enum_escalations_severity AS ENUM ('Critical', 'High', 'Medium', 'Low');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_escalations_triggertype') THEN
    CREATE TYPE enum_escalations_triggertype AS ENUM ('Deadline Breach', 'Missing Docs', 'Stuck Case', 'Payment Issue', 'Other');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_escalations_status') THEN
    CREATE TYPE enum_escalations_status AS ENUM ('Open', 'In Progress', 'Monitoring', 'Chasing', 'Resolved', 'Closed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "escalations" (
  "id" SERIAL PRIMARY KEY,
  "caseId" VARCHAR(255) NOT NULL,
  "candidate" VARCHAR(255) NOT NULL,
  "severity" enum_escalations_severity NOT NULL DEFAULT 'Medium',
  "trigger" TEXT NOT NULL,
  "triggerType" enum_escalations_triggertype NOT NULL DEFAULT 'Other',
  "assignedAdminId" INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "assignedAdminName" VARCHAR(255),
  "daysOpen" INTEGER NOT NULL DEFAULT 0,
  "status" enum_escalations_status NOT NULL DEFAULT 'Open',
  "notes" TEXT,
  "resolvedAt" TIMESTAMP WITH TIME ZONE,
  "resolvedBy" INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "relatedCaseId" INTEGER REFERENCES "cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
