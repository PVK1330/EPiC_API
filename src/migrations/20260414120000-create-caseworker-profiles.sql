-- Caseworker extended profile (1:1 with users where role = caseworker)
-- Run after `users` and `roles` exist. Timestamps match Sequelize default (camelCase).

CREATE TABLE IF NOT EXISTS "caseworker_profiles" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL UNIQUE REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "employee_id" VARCHAR(50) UNIQUE,
  "job_title" VARCHAR(150),
  "department" VARCHAR(100),
  "region" VARCHAR(100),
  "timezone" VARCHAR(64),
  "date_of_joining" DATE,
  "emergency_contact_name" VARCHAR(150),
  "emergency_contact_phone" VARCHAR(30),
  "notes" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_caseworker_profiles_user_id" ON "caseworker_profiles" ("user_id");
