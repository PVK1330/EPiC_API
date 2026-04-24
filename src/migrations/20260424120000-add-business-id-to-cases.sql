-- Add businessId column to cases table (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cases' AND column_name = 'businessId'
    ) THEN
        ALTER TABLE cases 
        ADD COLUMN "businessId" INTEGER REFERENCES users(id);
        
        -- Add comment to the column
        COMMENT ON COLUMN cases."businessId" IS 'Foreign key to users table for business/sponsor';
    END IF;
END $$;
