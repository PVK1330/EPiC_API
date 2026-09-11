-- Case ID Generation feature: per-visa-type code embedded in generated Case
-- IDs (e.g. "SW" in EPIC-SW26-001). Admin-settable via Admin Settings > Visa
-- Types; generateCaseId() falls back to "OTH" when unset.
ALTER TABLE visa_types
  ADD COLUMN IF NOT EXISTS code VARCHAR(20);

DROP INDEX IF EXISTS idx_visa_types_code_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_visa_types_code_unique
  ON visa_types (UPPER(code))
  WHERE code IS NOT NULL AND code <> '';

-- Best-effort backfill for the known seeded names. Two historical seed
-- sources exist with slightly different wording (006_core_business_tables /
-- 20260414130000-admin-settings-tables.sql's SQL seed vs
-- tenantSeed.service.js's DEFAULT_VISA_TYPES), so more than one row can
-- match a given pattern in the same DB. Each UPDATE is scoped to a single
-- row via a subquery so it can never collide with the unique index above;
-- any extra duplicate-named rows are simply left uncoded (fall back to
-- "OTH") for an admin to fix manually via Settings.
UPDATE visa_types SET code = 'SW'
WHERE id = (
  SELECT id FROM visa_types
  WHERE name ILIKE 'Skilled Worker%' AND (code IS NULL OR code = '')
  ORDER BY id ASC LIMIT 1
);

UPDATE visa_types SET code = 'ILR'
WHERE id = (
  SELECT id FROM visa_types
  WHERE name ILIKE '%Indefinite Leave to Remain%' AND (code IS NULL OR code = '')
  ORDER BY id ASC LIMIT 1
);

UPDATE visa_types SET code = 'SPL'
WHERE id = (
  SELECT id FROM visa_types
  WHERE name ILIKE 'Sponsor Licence%' AND (code IS NULL OR code = '')
  ORDER BY id ASC LIMIT 1
);
