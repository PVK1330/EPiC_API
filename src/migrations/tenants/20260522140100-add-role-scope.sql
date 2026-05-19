ALTER TABLE roles ADD COLUMN IF NOT EXISTS scope VARCHAR(20) NOT NULL DEFAULT 'tenant';

UPDATE roles SET scope = 'platform' WHERE id = 5 OR name = 'superadmin';
