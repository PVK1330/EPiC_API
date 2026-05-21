-- Add gender column to users table (safe for existing platform DBs)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
        AND table_name = 'users'
        AND column_name = 'gender'
    ) THEN
        ALTER TABLE users ADD COLUMN gender VARCHAR(20) DEFAULT 'other';
        CREATE INDEX IF NOT EXISTS idx_users_gender ON users(gender);
    END IF;
END $$;
