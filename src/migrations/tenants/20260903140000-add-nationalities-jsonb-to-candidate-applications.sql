-- BUG-008: Add multiple nationalities JSONB support to candidate_applications (idempotent)
ALTER TABLE candidate_applications
  ADD COLUMN IF NOT EXISTS "nationalities" JSONB DEFAULT '[]'::jsonb;

-- Backfill legacy single-nationality values into nationalities array where non-empty
UPDATE candidate_applications
  SET "nationalities" = jsonb_build_array("nationality")
  WHERE ("nationalities" IS NULL OR "nationalities" = '[]'::jsonb)
    AND "nationality" IS NOT NULL
    AND TRIM("nationality") != '';
