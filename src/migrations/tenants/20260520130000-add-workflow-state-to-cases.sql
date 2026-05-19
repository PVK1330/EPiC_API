-- Post-CCL workflow state (draft review, biometrics, visa portal) on cases.
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS "workflowState" JSONB DEFAULT '{}'::jsonb;

UPDATE cases
SET "workflowState" = '{}'::jsonb
WHERE "workflowState" IS NULL;
