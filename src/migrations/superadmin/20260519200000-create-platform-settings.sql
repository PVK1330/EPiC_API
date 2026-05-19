CREATE TABLE IF NOT EXISTS "platform_settings" (
    "id" SERIAL PRIMARY KEY,
    "key" VARCHAR(100) NOT NULL UNIQUE,
    "value" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_settings_key ON platform_settings(key);
