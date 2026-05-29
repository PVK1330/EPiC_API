-- Migration: Create calendar_connections table
-- Created at: 2026-05-29

CREATE TABLE IF NOT EXISTS "calendar_connections" (
    "id" SERIAL PRIMARY KEY,
    "user_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "provider" VARCHAR(50) NOT NULL, -- 'google'
    "provider_user_id" VARCHAR(255),
    "provider_account_name" VARCHAR(255),
    "email" VARCHAR(255),
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMP WITH TIME ZONE,
    "scopes" TEXT,
    "is_active" BOOLEAN DEFAULT TRUE,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT "user_provider_unique" UNIQUE ("user_id", "provider")
);

CREATE INDEX IF NOT EXISTS "calendar_connections_user_id_idx" ON "calendar_connections" ("user_id");
