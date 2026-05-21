-- Repair tenant DBs provisioned before camelCase timestamp alignment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'roles' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE roles RENAME COLUMN created_at TO "createdAt";
    ALTER TABLE roles RENAME COLUMN updated_at TO "updatedAt";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'permissions' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE permissions RENAME COLUMN created_at TO "createdAt";
    ALTER TABLE permissions RENAME COLUMN updated_at TO "updatedAt";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'role_permissions' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE role_permissions RENAME COLUMN created_at TO "createdAt";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'role_permissions' AND column_name = 'updatedAt'
  ) THEN
    ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'role_permissions' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE role_permissions RENAME COLUMN updated_at TO "updatedAt";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'departments' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE departments RENAME COLUMN created_at TO "createdAt";
    ALTER TABLE departments RENAME COLUMN updated_at TO "updatedAt";
  END IF;
END $$;

ALTER TABLE roles ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
UPDATE roles SET status = 'active' WHERE status IS NULL;
