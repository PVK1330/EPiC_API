-- Add sla_percentage column to caseworker_profiles table
ALTER TABLE "caseworker_profiles"
ADD COLUMN "sla_percentage" FLOAT DEFAULT 0;

-- Add comment
COMMENT ON COLUMN "caseworker_profiles"."sla_percentage" IS 'SLA compliance percentage (0-100)';
