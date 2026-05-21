-- Appointments and calendar meetings (used by shared appointments/calendar modules)

CREATE TABLE IF NOT EXISTS "appointments" (
    "id" SERIAL PRIMARY KEY,
    "case_id" INTEGER REFERENCES "cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "candidate_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "caseworker_id" INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "date" DATE NOT NULL,
    "time" TIME NOT NULL,
    "platform" VARCHAR(50) NOT NULL DEFAULT 'teams',
    "meeting_url" VARCHAR(500),
    "status" VARCHAR(50) NOT NULL DEFAULT 'scheduled',
    "invited_staff" JSONB DEFAULT '[]'::jsonb,
    "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "appointments_candidate_id_idx" ON "appointments" ("candidate_id");
CREATE INDEX IF NOT EXISTS "appointments_caseworker_id_idx" ON "appointments" ("caseworker_id");
CREATE INDEX IF NOT EXISTS "appointments_date_idx" ON "appointments" ("date");

CREATE TABLE IF NOT EXISTS "calendar_meetings" (
    "id" SERIAL PRIMARY KEY,
    "user_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "subject" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "start_time" TIMESTAMP WITH TIME ZONE NOT NULL,
    "end_time" TIMESTAMP WITH TIME ZONE NOT NULL,
    "attendees" JSONB DEFAULT '[]'::jsonb,
    "meeting_type" VARCHAR(50) NOT NULL DEFAULT 'online',
    "reminder_minutes" INTEGER NOT NULL DEFAULT 15,
    "related_case_id" INTEGER,
    "join_url" VARCHAR(500),
    "status" VARCHAR(50) NOT NULL DEFAULT 'scheduled',
    "event_type" VARCHAR(50) NOT NULL DEFAULT 'teams',
    "location" VARCHAR(500) DEFAULT '',
    "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "calendar_meetings_user_id_idx" ON "calendar_meetings" ("user_id");
CREATE INDEX IF NOT EXISTS "calendar_meetings_start_time_idx" ON "calendar_meetings" ("start_time");
