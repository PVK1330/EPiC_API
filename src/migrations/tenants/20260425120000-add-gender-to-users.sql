-- Add gender column to users table (safe for production)
DO $$
BEGIN
    -- Check if column exists before adding
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = current_schema()
        AND table_name = 'users' 
        AND column_name = 'gender'
    ) THEN
        -- First, add the column as VARCHAR to avoid ENUM issues during migration
        ALTER TABLE users ADD COLUMN gender VARCHAR(10) DEFAULT 'other';
        
        -- Create index for better performance
        CREATE INDEX idx_users_gender ON users(gender);
        
        RAISE NOTICE 'gender column added to users table';
    ELSE
        RAISE NOTICE 'gender column already exists in users table';
    END IF;
END $$;
