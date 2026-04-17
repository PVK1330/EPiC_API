-- Add userFileName column to documents table
-- Migration: 20260416150000-add-userfilename-to-documents.sql

ALTER TABLE documents 
ADD COLUMN userFileName VARCHAR(255) NULL AFTER documentName;

-- Add comment for the new column
COMMENT ON COLUMN documents.userFileName IS 'Filename provided by user in payload';
