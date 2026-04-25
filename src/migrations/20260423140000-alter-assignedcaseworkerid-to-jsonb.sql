-- Alter assignedcaseworkerId column from JSON to JSONB to support containment operators
ALTER TABLE "cases" ALTER COLUMN "assignedcaseworkerId" TYPE JSONB USING "assignedcaseworkerId"::jsonb;
