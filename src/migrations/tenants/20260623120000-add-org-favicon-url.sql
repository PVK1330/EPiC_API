-- Add favicon_url to the tenant organisations table
ALTER TABLE IF EXISTS "organisations"
  ADD COLUMN IF NOT EXISTS "favicon_url" VARCHAR(500);
