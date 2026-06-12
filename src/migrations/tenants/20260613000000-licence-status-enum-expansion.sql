-- Migration: Add Government Processing and Decision Pending to licence application status enum
-- These two intermediate states support the government submission pipeline:
--   Under Review → Government Processing → Decision Pending → Approved/Rejected

ALTER TYPE enum_licence_applications_status ADD VALUE IF NOT EXISTS 'Government Processing';
ALTER TYPE enum_licence_applications_status ADD VALUE IF NOT EXISTS 'Decision Pending';
