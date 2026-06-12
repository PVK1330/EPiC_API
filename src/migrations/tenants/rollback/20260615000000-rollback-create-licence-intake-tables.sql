-- Rollback: Drop licence intake tables created by 20260615000000.
-- Tables must be dropped before their dependent ENUM types.

DROP TABLE IF EXISTS "licence_intake_documents";
DROP TABLE IF EXISTS "licence_intake_forms";

DROP TYPE IF EXISTS "enum_licence_intake_documents_status";
DROP TYPE IF EXISTS "enum_licence_intake_documents_category";
