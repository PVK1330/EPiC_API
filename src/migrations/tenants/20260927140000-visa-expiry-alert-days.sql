-- Phase 2 UAT 3.1: "Please confirm how far ahead alerts are raised" — make the
-- visa expiry alert window a per-firm setting (was hard-coded to 30 days).
-- Default 90 days: ILR and other in-country applications must be made before
-- current leave expires, so the client asked for early warning.
ALTER TABLE "sla_settings" ADD COLUMN IF NOT EXISTS "visa_expiry_alert_days" INTEGER NOT NULL DEFAULT 90;
INSERT INTO "sla_settings" ("id", "createdAt", "updatedAt") VALUES (1, NOW(), NOW()) ON CONFLICT ("id") DO NOTHING;
