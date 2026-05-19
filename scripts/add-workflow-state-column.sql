-- Prefer: node src/migrations/run.js tenants
-- (applies src/migrations/tenants/20260520130000-add-workflow-state-to-cases.sql)
--
-- Manual fallback per tenant database:
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS "workflowState" JSONB DEFAULT '{}'::jsonb;