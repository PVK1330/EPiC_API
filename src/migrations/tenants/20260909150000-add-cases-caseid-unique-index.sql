-- Belt-and-suspenders uniqueness guard for the new structured Case ID format
-- (EPIC-SW26-001). Partial because legacy rows use older formats
-- (Case-01, C-2601####) and "caseId" allows NULL.
DROP INDEX IF EXISTS idx_cases_caseid_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cases_caseid_unique
  ON cases ("caseId")
  WHERE "caseId" IS NOT NULL;
