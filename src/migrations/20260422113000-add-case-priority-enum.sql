-- Safely migrate cases.priority to enum_cases_priority without default cast errors
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'cases'
          AND column_name = 'priority'
    ) THEN
        RAISE NOTICE 'cases.priority column not found, skipping migration';
        RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_cases_priority') THEN
        CREATE TYPE enum_cases_priority AS ENUM ('low', 'medium', 'high', 'urgent');
    END IF;

    -- Drop default first to avoid PostgreSQL cast errors while changing column type.
    ALTER TABLE cases ALTER COLUMN priority DROP DEFAULT;

    -- Normalize unexpected values before enum cast.
    UPDATE cases
    SET priority = 'medium'
    WHERE priority IS NULL
       OR priority::text NOT IN ('low', 'medium', 'high', 'urgent');

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'cases'
          AND column_name = 'priority'
          AND udt_name <> 'enum_cases_priority'
    ) THEN
        ALTER TABLE cases
        ALTER COLUMN priority TYPE enum_cases_priority
        USING priority::text::enum_cases_priority;
    END IF;

    ALTER TABLE cases ALTER COLUMN priority SET DEFAULT 'medium';
END $$;
