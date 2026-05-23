-- Platform staff roles (superadmin panel) — separate from tenant roles 1–4

ALTER TABLE roles ADD COLUMN IF NOT EXISTS scope VARCHAR(20) NOT NULL DEFAULT 'tenant';

UPDATE roles SET scope = 'platform' WHERE id = 5 OR name = 'superadmin';

INSERT INTO roles (id, name, description, status, scope, "createdAt", "updatedAt")
VALUES
  (6, 'platform_support', 'Support Agent — organisations and dashboard', 'active', 'platform', NOW(), NOW()),
  (7, 'platform_billing', 'Billing Manager — payments, billing, audit', 'active', 'platform', NOW(), NOW()),
  (8, 'platform_compliance', 'Compliance Officer — audit and settings', 'active', 'platform', NOW(), NOW())
ON CONFLICT (name) DO UPDATE SET
  scope = 'platform',
  description = EXCLUDED.description,
  status = 'active',
  "updatedAt" = NOW();

SELECT setval(
  pg_get_serial_sequence('roles', 'id'),
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM roles), 8)
);
