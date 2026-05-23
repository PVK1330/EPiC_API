-- Align licence_applications with Sequelize model (assigned caseworkers, soft-delete optional)

ALTER TABLE "licence_applications"
  ADD COLUMN IF NOT EXISTS "assignedcaseworkerId" JSONB;

ALTER TABLE "licence_applications"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP WITH TIME ZONE;
