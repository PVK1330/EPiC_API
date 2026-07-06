-- Repair announcements tables created by the pre-merge variant of this
-- feature. That variant created the table with camelCase "createdAt" /
-- "updatedAt" timestamp columns and no organisation_id, while the current
-- Announcement model maps to snake_case created_at / updated_at and writes
-- organisation_id. Against the old shape every INSERT and the history list
-- SELECT fail (silently caught), so announcements send fine but the history
-- page stays empty. Rename/add the columns in place, preserving any rows.

DO $$
BEGIN
  IF to_regclass('public.announcements') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'announcements' AND column_name = 'createdAt'
    ) THEN
      ALTER TABLE announcements RENAME COLUMN "createdAt" TO created_at;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'announcements' AND column_name = 'updatedAt'
    ) THEN
      ALTER TABLE announcements RENAME COLUMN "updatedAt" TO updated_at;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'announcements' AND column_name = 'organisation_id'
    ) THEN
      ALTER TABLE announcements ADD COLUMN organisation_id INTEGER;
    END IF;

    -- Old shape used VARCHAR(200); canonical is VARCHAR(255).
    ALTER TABLE announcements ALTER COLUMN created_by_name TYPE VARCHAR(255);

    -- Canonical shape has NOW() defaults on the timestamps.
    ALTER TABLE announcements ALTER COLUMN created_at SET DEFAULT NOW();
    ALTER TABLE announcements ALTER COLUMN updated_at SET DEFAULT NOW();
  END IF;
END $$;

-- History is listed newest-first per organisation (matches the create-table
-- migration; no-op where it already exists).
CREATE INDEX IF NOT EXISTS idx_announcements_org_created
    ON announcements (organisation_id, created_at DESC);
