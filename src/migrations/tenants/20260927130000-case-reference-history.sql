-- Phase 2 UAT 3.3: one standard case reference format.
-- Old references (CAS-######, Case-NN, or a structured ref whose type code no
-- longer matches the case's visa type) are re-issued; the old value is kept here
-- so searches and old notification links still find the case.
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "previousCaseIds" JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS "cases_previous_case_ids_gin" ON "cases" USING GIN ("previousCaseIds");

-- One-off maintenance jobs per tenant (e.g. the case-reference type sync) record
-- themselves here so they never run twice.
CREATE TABLE IF NOT EXISTS "tenant_maintenance_runs" (
  "key" VARCHAR(100) PRIMARY KEY,
  "ran_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "details" JSONB
);
