-- Track when staff verified the sponsor-submitted UKVI portal credentials.
-- The government_portal_credentials stage runs sponsor → caseworker → admin, so
-- each reviewing role records its own verification timestamp. This lets the
-- caseworker / admin credential panels flip their button to "Verified" and lets
-- us notify the sponsor that their credentials were confirmed.
ALTER TABLE "licence_government_tracking"
  ADD COLUMN IF NOT EXISTS "ukvi_credentials_caseworker_verified_at" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "ukvi_credentials_admin_verified_at"      TIMESTAMP WITH TIME ZONE;
