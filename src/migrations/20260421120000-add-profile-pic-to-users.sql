-- Add profile_pic column to users table (safe for production)
DO $$
BEGIN
    -- Check if column exists before adding
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='users' 
        AND column_name='profile_pic'
    ) THEN
        ALTER TABLE users ADD COLUMN profile_pic VARCHAR(255);
        
        -- Create index for better performance
        CREATE INDEX idx_users_profile_pic ON users(profile_pic);
        
        RAISE NOTICE 'profile_pic column added to users table';
    ELSE
        RAISE NOTICE 'profile_pic column already exists in users table';
    END IF;
END $$;
