-- Add plan_id column to organisations table in tenant database
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS plan_id INTEGER;

-- Optional: If the table was using a hardcoded plan column (varchar), we might want to drop it 
-- but it's safer to keep it for now and just add the new one.
-- ALTER TABLE organisations DROP COLUMN IF EXISTS plan;
