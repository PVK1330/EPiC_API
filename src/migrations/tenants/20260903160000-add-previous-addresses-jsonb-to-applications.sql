-- BUG-010: Add multiple previousAddresses JSONB support to candidate_applications (idempotent)
ALTER TABLE candidate_applications
  ADD COLUMN IF NOT EXISTS "previousAddresses" JSONB DEFAULT '[]'::jsonb;

-- Backfill legacy single previousAddress values into previousAddresses array
UPDATE candidate_applications
  SET "previousAddresses" = jsonb_build_array(
    jsonb_strip_nulls(
      jsonb_build_object(
        'previousAddress', "previousAddress",
        'startDate', to_char("startDate", 'YYYY-MM-DD'),
        'endDate', to_char("endDate", 'YYYY-MM-DD')
      )
    )
  )
  WHERE ("previousAddresses" IS NULL OR "previousAddresses" = '[]'::jsonb)
    AND ("previousAddress" IS NOT NULL AND TRIM("previousAddress") != '');
