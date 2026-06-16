-- Migration: 20260618120000-normalize-image-paths-to-public  (PLATFORM / superadmin)
--
-- Context
-- -------
-- Image references (profile pictures, org logos, platform branding) were stored
-- inconsistently: some as absolute disk paths baked into a URL
-- (http://localhost:5000/D:/.../storage/private/superadmin/x.jpg), some as dead
-- relative paths under uploads/ (no longer served), some with a hard-coded host.
-- The app now serves images ONLY at /api/public/images/<basename> and stores a
-- stable RELATIVE path "api/public/images/<basename>" in the DB (the frontend
-- prepends the API origin via resolveAssetUrl). See utils/storagePath.util.js.
--
-- This migration rewrites every existing image column to that canonical relative
-- form by extracting the file's basename and re-keying it under api/public/images.
-- The basename is preserved, and the static mount serves it from whichever of the
-- organisations/platform/superadmin/avatars dirs actually holds the file.
--
-- NOTE: platform migrations live in the superadmin/ directory (see run.js
-- listPlatformSqlFiles -> "superadmin").
--
-- Safety
-- ------
-- Idempotent: rows already starting with "api/public/images/" are skipped, and
-- NULL/empty values are left untouched. Only values that contain a path
-- separator (i.e. carry a filename) are rewritten. Re-running is a no-op.
-- Uses split_part(value,'?',1) to drop any querystring, then regexp_replace
-- '^.*/' for the basename (no backslash escapes -> safe inside DO $$).

DO $$
BEGIN
  -- 1. Platform users — profile_pic
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'profile_pic'
  ) THEN
    UPDATE "users"
    SET profile_pic =
      'api/public/images/' || regexp_replace(split_part(profile_pic, '?', 1), '^.*/', '')
    WHERE profile_pic IS NOT NULL
      AND profile_pic <> ''
      AND profile_pic NOT LIKE 'api/public/images/%'
      AND profile_pic LIKE '%/%';
  END IF;

  -- 2. Organisations — logo_url
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organisations' AND column_name = 'logo_url'
  ) THEN
    UPDATE "organisations"
    SET logo_url =
      'api/public/images/' || regexp_replace(split_part(logo_url, '?', 1), '^.*/', '')
    WHERE logo_url IS NOT NULL
      AND logo_url <> ''
      AND logo_url NOT LIKE 'api/public/images/%'
      AND logo_url LIKE '%/%';
  END IF;

  -- 3. Platform settings — logo_url & favicon_url (key/value rows)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'platform_settings'
  ) THEN
    UPDATE "platform_settings"
    SET value =
      'api/public/images/' || regexp_replace(split_part(value, '?', 1), '^.*/', '')
    WHERE key IN ('logo_url', 'favicon_url')
      AND value IS NOT NULL
      AND value <> ''
      AND value NOT LIKE 'api/public/images/%'
      AND value LIKE '%/%';
  END IF;

END $$;
