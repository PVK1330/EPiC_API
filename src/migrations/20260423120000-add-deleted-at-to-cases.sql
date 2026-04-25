-- Add deleted_at column to cases table for soft delete functionality
ALTER TABLE "cases" 
ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP;

CREATE INDEX IF NOT EXISTS "idx_cases_deleted_at" ON "cases" ("deleted_at");
