-- Admin settings: per-admin preferences, visa types, case categories, email templates, SLA (singleton)
-- Requires "users" and "roles". Timestamps match Sequelize defaults.

CREATE TABLE IF NOT EXISTS "admin_user_preferences" (
  "user_id" INTEGER PRIMARY KEY REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "avatar_url" VARCHAR(512),
  "two_factor_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "email_notifications" BOOLEAN NOT NULL DEFAULT TRUE,
  "case_updates" BOOLEAN NOT NULL DEFAULT TRUE,
  "payment_alerts" BOOLEAN NOT NULL DEFAULT FALSE,
  "timezone" VARCHAR(120) NOT NULL DEFAULT 'UTC-05:00 Eastern Time',
  "language" VARCHAR(50) NOT NULL DEFAULT 'English',
  "date_format" VARCHAR(30) NOT NULL DEFAULT 'MM/DD/YYYY',
  "data_collection" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "visa_types" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR(255) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_visa_types_name_lower" ON "visa_types" (LOWER(TRIM("name")));

CREATE TABLE IF NOT EXISTS "case_categories" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_case_categories_name_lower" ON "case_categories" (LOWER(TRIM("name")));

CREATE TABLE IF NOT EXISTS "email_templates" (
  "id" SERIAL PRIMARY KEY,
  "template_key" VARCHAR(50) NOT NULL UNIQUE,
  "subject" TEXT NOT NULL DEFAULT '',
  "body" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "sla_settings" (
  "id" SERIAL PRIMARY KEY,
  "skilled_worker_days" INTEGER NOT NULL DEFAULT 45,
  "ilr_days" INTEGER NOT NULL DEFAULT 30,
  "student_visa_days" INTEGER NOT NULL DEFAULT 60,
  "escalation_stuck_days" INTEGER NOT NULL DEFAULT 3,
  "missing_docs_escalation_days" INTEGER NOT NULL DEFAULT 7,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Singleton SLA row (id = 1)
INSERT INTO "sla_settings" ("id", "skilled_worker_days", "ilr_days", "student_visa_days", "escalation_stuck_days", "missing_docs_escalation_days", "createdAt", "updatedAt")
VALUES (1, 45, 30, 60, 3, 7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Seed visa types (only if table empty)
INSERT INTO "visa_types" ("name", "sort_order", "createdAt", "updatedAt")
SELECT v.name, v.ord, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('Skilled Worker Visa', 1),
  ('Indefinite Leave to Remain (ILR)', 2),
  ('Graduate Visa', 3),
  ('Student Visa', 4),
  ('Sponsor Licence', 5)
) AS v(name, ord)
WHERE NOT EXISTS (SELECT 1 FROM "visa_types" LIMIT 1);

-- Seed case categories
INSERT INTO "case_categories" ("name", "createdAt", "updatedAt")
SELECT c.name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES ('Urgent'), ('VIP'), ('Standard')) AS c(name)
WHERE NOT EXISTS (SELECT 1 FROM "case_categories" LIMIT 1);

-- Seed email template keys (empty body ok; frontend has defaults)
INSERT INTO "email_templates" ("template_key", "subject", "body", "createdAt", "updatedAt")
SELECT t.k, t.s, t.b, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('payment', '[VisaFlow] Action Required: Outstanding Payment', 'Dear {{client_name}},

We wanted to remind you that your outstanding balance of {{amount}} is now {{days_overdue}} days overdue.

Please arrange payment at your earliest convenience.

Best regards,
VisaFlow Team'),
  ('doc', '[VisaFlow] Documents required', 'Please upload the requested documents for your case.'),
  ('opened', '[VisaFlow] Case opened', 'Your case has been opened. Reference: {{case_ref}}'),
  ('expiry', '[VisaFlow] Visa expiry alert', 'Reminder: your visa may expire on {{expiry_date}}.'),
  ('welcome', '[VisaFlow] Welcome', 'Welcome to VisaFlow, {{client_name}}.')
) AS t(k, s, b)
WHERE NOT EXISTS (SELECT 1 FROM "email_templates" LIMIT 1);
