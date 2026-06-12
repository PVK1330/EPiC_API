-- Rollback: Revert licence_application_audits.action to VARCHAR(50).
-- WARNING: Any existing rows with action values longer than 50 chars will
-- cause this to fail. Truncate or clean those rows first if needed.

ALTER TABLE "licence_application_audits"
  ALTER COLUMN "action" TYPE VARCHAR(50);
