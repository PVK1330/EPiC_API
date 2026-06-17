-- Track the provenance of an intake document slot so the checklist can show a
-- "Imported from Licence Application" badge and avoid forcing sponsors to upload
-- the same evidence twice (once for Appendix A in Stage 4, once for the intake
-- checklist in Stage 10).
--
--   source                      'manual'                  — sponsor uploaded directly (default)
--                               'imported_from_application' — auto-attached from a Stage 4 Appendix A upload
--   source_appendix_document_id the licence_appendix_documents.id the file was imported from (audit trail)
--
-- Idempotent: safe to re-run.

ALTER TABLE "licence_intake_documents"
  ADD COLUMN IF NOT EXISTS "source" VARCHAR(40) NOT NULL DEFAULT 'manual';

ALTER TABLE "licence_intake_documents"
  ADD COLUMN IF NOT EXISTS "source_appendix_document_id" INTEGER;

COMMENT ON COLUMN "licence_intake_documents"."source"
  IS 'Provenance of the uploaded file: ''manual'' (sponsor upload) or ''imported_from_application'' (auto-attached from a Stage 4 Appendix A document).';

COMMENT ON COLUMN "licence_intake_documents"."source_appendix_document_id"
  IS 'When source = imported_from_application, the licence_appendix_documents.id the file was imported from.';
