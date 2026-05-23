ALTER TABLE document_checklists ADD COLUMN IF NOT EXISTS case_id INTEGER REFERENCES "cases"(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_document_checklists_case_id ON document_checklists(case_id);
