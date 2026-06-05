-- Dynamic, per-org Client Care Letter (CCL) templates.
-- Replaces the static .docx-per-visa-type approach: each org authors its own
-- rich-text CCL template(s) with {{tags}} that are interpolated per candidate at
-- issue time, then rendered to a branded PDF. Per-tenant table => per-org by design.
--
-- Resolution (mirrors data_capture_templates): an active row matching the case's
-- visa_type_id wins; otherwise the active org default (visa_type_id IS NULL).

CREATE TABLE IF NOT EXISTS "ccl_templates" (
  "id" SERIAL PRIMARY KEY,
  "visa_type_id" INTEGER REFERENCES "visa_types"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  "name" VARCHAR(255) NOT NULL,
  "body_html" TEXT NOT NULL DEFAULT '',
  "header_html" TEXT,
  "footer_html" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by" INTEGER,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_ccl_templates_visa_type" ON "ccl_templates" ("visa_type_id");

-- At most one active org-default template (visa_type_id IS NULL) at a time.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ccl_templates_one_active_default"
  ON "ccl_templates" (("visa_type_id" IS NULL))
  WHERE "visa_type_id" IS NULL AND "is_active" = TRUE;

-- At most one active template per visa type.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ccl_templates_one_active_per_visa"
  ON "ccl_templates" ("visa_type_id")
  WHERE "visa_type_id" IS NOT NULL AND "is_active" = TRUE;
