CREATE TABLE IF NOT EXISTS "plans" (
    "id" SERIAL PRIMARY KEY,
    "name" VARCHAR(100) NOT NULL UNIQUE,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'GBP',
    "billing_cycle" VARCHAR(20) NOT NULL
        CHECK ("billing_cycle" IN ('monthly','yearly','one-time')),
    "user_quota" INTEGER NOT NULL DEFAULT 5,
    "case_quota" INTEGER NOT NULL DEFAULT 50,
    "storage_quota_gb" INTEGER NOT NULL DEFAULT 1,
    "features" JSONB DEFAULT '[]'::jsonb,
    "is_public" BOOLEAN DEFAULT TRUE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK ("status" IN ('active','inactive','archived')),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
CREATE INDEX IF NOT EXISTS idx_plans_public ON plans(is_public);
