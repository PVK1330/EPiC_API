-- Per-case CCL draft: the editable, already-interpolated letter for one candidate.
-- A caseworker/admin can generate from the org template, tweak the wording for the
-- specific case, then issue. When set, the generator renders this instead of the
-- org template.
ALTER TABLE "case_ccl_records" ADD COLUMN IF NOT EXISTS "draft_html" TEXT;
