-- Mirror of superadmin/20260909120000-add-organisations-code.sql. Unique
-- within this tenant DB (case-insensitive) because multiple organisations
-- can coexist here and share one visible Case ID namespace.
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS code VARCHAR(20);

DROP INDEX IF EXISTS idx_organisations_code_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_organisations_code_unique
  ON organisations (UPPER(code))
  WHERE code IS NOT NULL AND code <> '';

UPDATE organisations SET code = 'EPIC'
WHERE slug = 'epic-default' AND (code IS NULL OR code = '');
