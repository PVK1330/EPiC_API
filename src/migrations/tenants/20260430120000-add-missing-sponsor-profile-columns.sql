-- Add missing columns to sponsor_profiles table
ALTER TABLE sponsor_profiles ADD COLUMN IF NOT EXISTS authorising_job_title VARCHAR(255);
ALTER TABLE sponsor_profiles ADD COLUMN IF NOT EXISTS hr_job_title VARCHAR(255);
ALTER TABLE sponsor_profiles ADD COLUMN IF NOT EXISTS key_contact_department VARCHAR(255);
