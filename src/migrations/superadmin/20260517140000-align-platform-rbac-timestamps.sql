-- Align legacy snake_case timestamp columns with Sequelize (createdAt / updatedAt)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'roles' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE roles RENAME COLUMN created_at TO "createdAt";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'roles' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE roles RENAME COLUMN updated_at TO "updatedAt";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'permissions' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE permissions RENAME COLUMN created_at TO "createdAt";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'permissions' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE permissions RENAME COLUMN updated_at TO "updatedAt";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'role_permissions' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE role_permissions RENAME COLUMN created_at TO "createdAt";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'role_permissions' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE role_permissions RENAME COLUMN updated_at TO "updatedAt";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'role_permissions' AND column_name = 'updatedAt'
  ) THEN
    ALTER TABLE role_permissions
      ADD COLUMN "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;
  END IF;
END $$;
