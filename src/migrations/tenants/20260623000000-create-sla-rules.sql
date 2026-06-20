-- Create the dynamic SLA rules table (backs SlaRule model / GET /api/settings/sla-rules).
-- The original admin-settings migration only created the singleton "sla_settings" table;
-- "sla_rules" was referenced by a later ALTER (organisation_id) guarded with IF EXISTS,
-- so it was never created. Without this table SlaRule.findAll() throws
-- 'relation "sla_rules" does not exist', surfaced to the client as a generic 500.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_sla_rules_rule_type') THEN
    CREATE TYPE enum_sla_rules_rule_type AS ENUM ('Visa', 'Global');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "sla_rules" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR(255) NOT NULL UNIQUE,
  "days" INTEGER NOT NULL DEFAULT 30,
  "rule_type" enum_sla_rules_rule_type NOT NULL DEFAULT 'Visa',
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Backfill the organisation_id column in case an empty table already existed from a
-- partial run (the earlier ALTER ... IF EXISTS would have been a no-op).
ALTER TABLE IF EXISTS "sla_rules"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
