-- Payment gateway settings (tenant). Safe on fresh DBs.
CREATE TABLE IF NOT EXISTS "payment_settings" (
    "id" SERIAL PRIMARY KEY,
    "active_gateway" VARCHAR(255) DEFAULT 'stripe',
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE "payment_settings"
  ADD COLUMN IF NOT EXISTS "active_gateway" VARCHAR(255) DEFAULT 'stripe';
