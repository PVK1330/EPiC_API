-- Tables referenced by sponsor panel APIs but only altered (never created) in older migrations.

CREATE TABLE IF NOT EXISTS "sponsor_user_preferences" (
    "userId" INTEGER PRIMARY KEY REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "email_notifications" BOOLEAN NOT NULL DEFAULT TRUE,
    "compliance_updates" BOOLEAN NOT NULL DEFAULT TRUE,
    "payment_reminders" BOOLEAN NOT NULL DEFAULT TRUE,
    "sms_alerts" BOOLEAN NOT NULL DEFAULT FALSE,
    "push_notifications" BOOLEAN NOT NULL DEFAULT TRUE,
    "timezone" VARCHAR(120) NOT NULL DEFAULT 'UTC+0 (London)',
    "language" VARCHAR(50) NOT NULL DEFAULT 'English',
    "date_format" VARCHAR(30) NOT NULL DEFAULT 'DD/MM/YYYY',
    "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "worker_events" (
    "id" SERIAL PRIMARY KEY,
    "sponsorId" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "workerId" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "caseId" INTEGER REFERENCES "cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "eventType" VARCHAR(100) NOT NULL,
    "eventDate" DATE NOT NULL,
    "reportedDate" DATE,
    "deadlineDate" DATE NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
    "description" TEXT,
    "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_worker_events_sponsor" ON "worker_events" ("sponsorId");
CREATE INDEX IF NOT EXISTS "idx_worker_events_deadline" ON "worker_events" ("deadlineDate");
