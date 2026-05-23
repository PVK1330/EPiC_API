-- Per-tenant operational schema patches (idempotent).
-- Full schema is created via Sequelize sync on provision; these are incremental fixes.

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS "caseStage" VARCHAR(64) DEFAULT 'client_enquiry';

UPDATE cases
SET "caseStage" = 'client_enquiry'
WHERE "caseStage" IS NULL;

CREATE INDEX IF NOT EXISTS idx_cases_case_stage ON cases ("caseStage");
CREATE INDEX IF NOT EXISTS idx_cases_candidate_id ON cases ("candidateId");

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS notes TEXT;
