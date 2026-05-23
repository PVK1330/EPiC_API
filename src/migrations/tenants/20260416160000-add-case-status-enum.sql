-- Create enum type for case status
-- Migration: 20260416160000-add-case-status-enum.sql

-- Create enum type for case status values
DO $$ 
BEGIN
    -- Create enum type for case status only if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'case_status_enum') THEN
        CREATE TYPE case_status_enum AS ENUM ('Lead', 'Pending', 'In Progress', 'Completed', 'On Hold', 'Cancelled');
    END IF;

    -- Drop default value first to avoid casting issues
    ALTER TABLE cases ALTER COLUMN status DROP DEFAULT;

    -- Update any existing null values to a valid enum value
    UPDATE cases SET status = 'Pending' WHERE status IS NULL OR status NOT IN ('Lead', 'Pending', 'In Progress', 'Completed', 'On Hold', 'Cancelled');

    -- Alter cases table to use enum type
    ALTER TABLE cases 
    ALTER COLUMN status TYPE case_status_enum 
    USING status::text::case_status_enum;

    -- Set new default value
    ALTER TABLE cases ALTER COLUMN status SET DEFAULT 'Pending';

    -- Add comment for the status column
    COMMENT ON COLUMN cases.status IS 'Case status with enum values: Lead, Pending, In Progress, Completed, On Hold, Cancelled';
END $$;
