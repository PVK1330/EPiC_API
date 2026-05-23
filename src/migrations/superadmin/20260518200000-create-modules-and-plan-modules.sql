CREATE TABLE IF NOT EXISTS "modules" (
    "id" SERIAL PRIMARY KEY,
    "key" VARCHAR(100) NOT NULL UNIQUE,
    "label" VARCHAR(150) NOT NULL,
    "panel" VARCHAR(20) NOT NULL CHECK (panel IN ('admin', 'caseworker', 'candidate', 'business')),
    "icon" VARCHAR(100),
    "sort_order" INTEGER DEFAULT 0,
    "is_active" BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_modules_panel ON modules(panel);
CREATE INDEX IF NOT EXISTS idx_modules_is_active ON modules(is_active);

CREATE TABLE IF NOT EXISTS "plan_modules" (
    "id" SERIAL PRIMARY KEY,
    "plan_id" INTEGER NOT NULL REFERENCES "plans"("id") ON DELETE CASCADE,
    "module_id" INTEGER NOT NULL REFERENCES "modules"("id") ON DELETE CASCADE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE ("plan_id", "module_id")
);

CREATE INDEX IF NOT EXISTS idx_plan_modules_plan_id ON plan_modules(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_modules_module_id ON plan_modules(module_id);
