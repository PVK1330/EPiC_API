-- Add pipeline stage values to case status enum
-- Migration: 20260423130000-add-pipeline-status-enum.sql

DO $$ 
BEGIN
    -- Add new enum values to case_status_enum
    -- PostgreSQL doesn't support ALTER TYPE ADD VALUE with IF NOT EXISTS directly,
    -- so we need to check if each value exists before adding
    
    -- Add 'Docs Pending'
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'Docs Pending' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'case_status_enum')) THEN
        ALTER TYPE case_status_enum ADD VALUE 'Docs Pending';
    END IF;
    
    -- Add 'Drafting'
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'Drafting' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'case_status_enum')) THEN
        ALTER TYPE case_status_enum ADD VALUE 'Drafting';
    END IF;
    
    -- Add 'Submitted'
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'Submitted' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'case_status_enum')) THEN
        ALTER TYPE case_status_enum ADD VALUE 'Submitted';
    END IF;
    
    -- Add 'Decision'
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'Decision' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'case_status_enum')) THEN
        ALTER TYPE case_status_enum ADD VALUE 'Decision';
    END IF;
    
    -- Add 'Under Review'
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'Under Review' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'case_status_enum')) THEN
        ALTER TYPE case_status_enum ADD VALUE 'Under Review';
    END IF;
    
    -- Add 'Overdue'
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'Overdue' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'case_status_enum')) THEN
        ALTER TYPE case_status_enum ADD VALUE 'Overdue';
    END IF;
    
    -- Add 'Approved'
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'Approved' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'case_status_enum')) THEN
        ALTER TYPE case_status_enum ADD VALUE 'Approved';
    END IF;
    
    -- Add 'Rejected'
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'Rejected' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'case_status_enum')) THEN
        ALTER TYPE case_status_enum ADD VALUE 'Rejected';
    END IF;
    
    -- Add 'Closed'
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'Closed' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'case_status_enum')) THEN
        ALTER TYPE case_status_enum ADD VALUE 'Closed';
    END IF;
    
    -- Update default value to 'Lead'
    ALTER TABLE cases ALTER COLUMN status SET DEFAULT 'Lead';
    
    -- Update comment
    COMMENT ON COLUMN cases.status IS 'Case status with enum values: Lead, Pending, Docs Pending, Drafting, Submitted, Decision, In Progress, Completed, On Hold, Cancelled, Under Review, Overdue, Approved, Rejected, Closed';
END $$;
