-- Create enum type for case status
-- Migration: 20260416160000-add-case-status-enum.sql

-- Create enum type for case status values
DO $$ BEGIN;

-- Create enum type for case status
CREATE TYPE case_status_enum AS ENUM ('Lead', 'Pending', 'In Progress', 'Completed', 'On Hold', 'Cancelled');

-- Alter cases table to use enum type
ALTER TABLE cases 
ALTER COLUMN status TYPE case_status_enum 
USING status::text::case_status_enum;

-- Add comment for the status column
COMMENT ON COLUMN cases.status IS 'Case status with enum values: Lead, Pending, In Progress, Completed, On Hold, Cancelled';

DO $$ COMMIT;
