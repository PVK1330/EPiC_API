-- Add description column to roles table if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'roles' 
        AND column_name = 'description'
    ) THEN
        ALTER TABLE roles ADD COLUMN description TEXT;
    END IF;
END $$;
