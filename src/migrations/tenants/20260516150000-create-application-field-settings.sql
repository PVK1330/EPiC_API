-- Application form field configuration (required by tenant seed)
CREATE TABLE IF NOT EXISTS "application_field_settings" (
  "id" SERIAL PRIMARY KEY,
  "field_key" VARCHAR(255) NOT NULL UNIQUE,
  "field_label" VARCHAR(255) NOT NULL,
  "is_visible" BOOLEAN NOT NULL DEFAULT TRUE,
  "is_required" BOOLEAN NOT NULL DEFAULT FALSE,
  "field_order" INTEGER NOT NULL DEFAULT 0,
  "field_type" VARCHAR(50) NOT NULL DEFAULT 'text',
  "options" JSONB,
  "validation_rules" JSONB,
  "description" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_application_field_settings_field_order
  ON "application_field_settings" ("field_order");

CREATE TABLE IF NOT EXISTS "application_custom_fields" (
  "id" SERIAL PRIMARY KEY,
  "field_id" VARCHAR(255) NOT NULL UNIQUE,
  "label" VARCHAR(255) NOT NULL,
  "field_type" VARCHAR(50) NOT NULL DEFAULT 'text',
  "placeholder" VARCHAR(255),
  "is_required" BOOLEAN NOT NULL DEFAULT FALSE,
  "options" JSONB,
  "validation_rules" JSONB,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
