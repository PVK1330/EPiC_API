-- Rollback: remove the intake document provenance columns.

ALTER TABLE "licence_intake_documents" DROP COLUMN IF EXISTS "source_appendix_document_id";
ALTER TABLE "licence_intake_documents" DROP COLUMN IF EXISTS "source";
