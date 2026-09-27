-- Issue #8: Add visaEndDate column to cases table to allow per-case visa expiry tracking
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "visaEndDate" TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS "cases_visa_end_date_idx" ON "cases" ("visaEndDate");
