-- Add notes column to documents table
-- Migration: 20260428120000-add-notes-to-documents.sql

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'documents' AND column_name = 'notes'
    ) THEN
        ALTER TABLE documents ADD COLUMN notes TEXT;
        COMMENT ON COLUMN documents.notes IS 'Additional notes provided during document upload';
    END IF;
END $$;
