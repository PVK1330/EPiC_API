-- BUG-014: allow multiple travel-history entries. Add a JSONB array and backfill
-- the legacy single trip (countryVisited / visitReason / entryDate / leaveDate).
ALTER TABLE candidate_applications
  ADD COLUMN IF NOT EXISTS "travelHistory" JSONB DEFAULT '[]'::jsonb;

UPDATE candidate_applications
  SET "travelHistory" = jsonb_build_array(
    jsonb_strip_nulls(
      jsonb_build_object(
        'countryVisited', "countryVisited",
        'visitReason', "visitReason",
        'entryDate', to_char("entryDate", 'YYYY-MM-DD'),
        'leaveDate', to_char("leaveDate", 'YYYY-MM-DD')
      )
    )
  )
  WHERE ("travelHistory" IS NULL OR "travelHistory" = '[]'::jsonb)
    AND ("countryVisited" IS NOT NULL AND TRIM("countryVisited") != '');
