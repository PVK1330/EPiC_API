-- Align platform_audit_logs table with the PlatformAuditLog model.
-- The model declares user_id / details / ip_address (the "new" fields) alongside
-- the legacy category/user/org/description columns, but the physical table was
-- created before those fields existed. Sequelize's findAndCountAll selects all
-- model attributes, so the missing columns caused every GET /api/superadmin/audit-log
-- to fail with a 500 (column "user_id" does not exist).
ALTER TABLE "platform_audit_logs"
  ADD COLUMN IF NOT EXISTS "user_id" INTEGER NULL REFERENCES "users" ("id"),
  ADD COLUMN IF NOT EXISTS "details" TEXT NULL,
  ADD COLUMN IF NOT EXISTS "ip_address" VARCHAR(100) NULL;
