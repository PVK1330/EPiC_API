ALTER TABLE cases ADD COLUMN IF NOT EXISTS workflow_meta JSONB DEFAULT '{}'::jsonb;
