-- Add status column to roles table
ALTER TABLE roles ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';

-- Update existing roles to have 'active' status
UPDATE roles SET status = 'active' WHERE status IS NULL;

-- Add check constraint for status values (PostgreSQL doesn't support IF NOT EXISTS for constraints)
-- Use DO block to check if constraint exists before adding
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'check_role_status' 
        AND conrelid = 'roles'::regclass
    ) THEN
        ALTER TABLE roles ADD CONSTRAINT check_role_status CHECK (status IN ('active', 'inactive'));
    END IF;
END $$;
