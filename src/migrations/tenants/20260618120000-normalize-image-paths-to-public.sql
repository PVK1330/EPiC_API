-- Migration: 20260618120000-normalize-image-paths-to-public  (TENANT)
--
-- Tenant-schema counterpart of the platform migration of the same name.
-- Rewrites stored image references to the canonical relative public form
-- "api/public/images/<basename>" so they render via /api/public/images and the
-- frontend's resolveAssetUrl(). See utils/storagePath.util.js for the runtime
-- equivalent (toPublicImagePath).
--
-- Idempotent: skips NULL/empty and already-canonical values; rewrites only
-- values that contain a filename. Safe to re-run.

DO $$
BEGIN
  -- 1. Tenant users — profile_pic
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

  -- 2. Admin user preferences — avatar_url
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'admin_user_preferences' AND column_name = 'avatar_url'
  ) THEN
    UPDATE "admin_user_preferences"
    SET avatar_url =
      'api/public/images/' || regexp_replace(split_part(avatar_url, '?', 1), '^.*/', '')
    WHERE avatar_url IS NOT NULL
      AND avatar_url <> ''
      AND avatar_url NOT LIKE 'api/public/images/%'
      AND avatar_url LIKE '%/%';
  END IF;

  -- 3. Organisations — logo_url (mirrored into tenant schema)
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

END $$;
