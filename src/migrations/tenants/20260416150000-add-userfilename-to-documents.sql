-- Add userFileName column to documents table
-- Migration: 20260416150000-add-userfilename-to-documents.sql

DO $$
BEGIN
    -- Add userFileName column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' 
        AND column_name = 'userfilename'
    ) THEN
        ALTER TABLE documents 
        ADD COLUMN userFileName VARCHAR(255) NULL;
        
        -- Add comment for the new column
        COMMENT ON COLUMN documents.userFileName IS 'Filename provided by user in payload';
    END IF;
END $$;
