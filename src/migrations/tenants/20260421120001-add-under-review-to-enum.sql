-- Add missing values to case_status_enum
-- Migration: 20260421120001-add-under-review-to-enum.sql

DO $$
BEGIN
    -- Add 'Under Review' to the enum type if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_enum 
        WHERE enumlabel = 'Under Review' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'case_status_enum')
    ) THEN
        ALTER TYPE case_status_enum ADD VALUE 'Under Review';
    END IF;

    -- Add 'Overdue' to the enum type if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_enum 
        WHERE enumlabel = 'Overdue' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'case_status_enum')
    ) THEN
        ALTER TYPE case_status_enum ADD VALUE 'Overdue';
    END IF;

    -- Add 'Approved' to the enum type if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_enum 
        WHERE enumlabel = 'Approved' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'case_status_enum')
    ) THEN
        ALTER TYPE case_status_enum ADD VALUE 'Approved';
    END IF;

    -- Add 'Rejected' to the enum type if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_enum 
        WHERE enumlabel = 'Rejected' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'case_status_enum')
    ) THEN
        ALTER TYPE case_status_enum ADD VALUE 'Rejected';
    END IF;

    -- Add 'Closed' to the enum type if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_enum 
        WHERE enumlabel = 'Closed' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'case_status_enum')
    ) THEN
        ALTER TYPE case_status_enum ADD VALUE 'Closed';
    END IF;
END $$;
