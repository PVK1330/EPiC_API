-- Alter department column to departmentId with foreign key (idempotent)
DO $$
BEGIN
    -- Check if department column exists and drop it
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cases' AND column_name = 'department'
    ) THEN
        ALTER TABLE cases DROP COLUMN department;
    END IF;

    -- Add departmentId column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cases' AND column_name = 'departmentId'
    ) THEN
        ALTER TABLE cases 
        ADD COLUMN "departmentId" INTEGER REFERENCES departments(id);
        
        -- Add comment to the column
        COMMENT ON COLUMN cases."departmentId" IS 'Foreign key to departments table';
    END IF;
END $$;
