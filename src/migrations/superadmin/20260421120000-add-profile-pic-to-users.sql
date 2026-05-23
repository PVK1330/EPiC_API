-- Add profile_pic column to users table (safe for existing platform DBs)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
        AND table_name = 'users'
        AND column_name = 'profile_pic'
    ) THEN
        ALTER TABLE users ADD COLUMN profile_pic VARCHAR(500);
        CREATE INDEX IF NOT EXISTS idx_users_profile_pic ON users(profile_pic);
    END IF;
END $$;
