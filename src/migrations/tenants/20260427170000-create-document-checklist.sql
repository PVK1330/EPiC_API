-- Drop table if it exists (to handle failed migrations)
DROP TABLE IF EXISTS document_checklists CASCADE;

-- Create document_checklists table
CREATE TABLE document_checklists (
  id SERIAL PRIMARY KEY,
  visa_type_id INTEGER NOT NULL REFERENCES visa_types(id) ON DELETE CASCADE,
  document_type VARCHAR(100) NOT NULL,
  document_name VARCHAR(255) NOT NULL,
  description TEXT,
  is_required BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  category VARCHAR(20) NOT NULL DEFAULT 'other' CHECK (category IN ('identity', 'education', 'work', 'financial', 'medical', 'legal', 'other')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_document_checklists_visa_type_id ON document_checklists(visa_type_id);
CREATE INDEX IF NOT EXISTS idx_document_checklists_document_type ON document_checklists(document_type);
CREATE INDEX IF NOT EXISTS idx_document_checklists_category ON document_checklists(category);

-- Keep SERIAL sequence in sync if rows were inserted manually.
SELECT setval(
  pg_get_serial_sequence('"visa_types"', 'id'),
  COALESCE((SELECT MAX(id) FROM "visa_types"), 0) + 1,
  false
);

-- Ensure visa types used by this checklist exist.
-- Do not rely on fixed numeric IDs across environments.
INSERT INTO "visa_types" ("name", "sort_order", "createdAt", "updatedAt")
SELECT v.name, v.sort_order, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('Skilled Worker Visa', 1),
  ('Student Visa', 4),
  ('Health & Care Worker Visa', 6)
) AS v(name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM "visa_types" vt WHERE LOWER(TRIM(vt."name")) = LOWER(TRIM(v.name))
);

-- Skilled Worker Visa checklist
INSERT INTO document_checklists (visa_type_id, document_type, document_name, description, is_required, sort_order, category)
SELECT vt.id, x.document_type, x.document_name, x.description, x.is_required, x.sort_order, x.category
FROM "visa_types" vt
JOIN (VALUES
  ('passport', 'Valid Passport', 'Passport must be valid for at least 6 months beyond intended stay', true, 1, 'identity'),
  ('english_certificate', 'English Language Certificate', 'IELTS or equivalent English language test result', true, 2, 'education'),
  ('degree_certificate', 'Degree Certificate', 'Original degree certificate and transcripts', true, 3, 'education'),
  ('work_experience', 'Work Experience Letters', 'Employment letters for past 5 years', true, 4, 'work'),
  ('cos', 'Certificate of Sponsorship', 'Certificate of Sponsorship from employer', true, 5, 'legal'),
  ('bank_statement', 'Bank Statements', 'Proof of funds for maintenance', true, 6, 'financial'),
  ('tuberculosis_test', 'Tuberculosis Test Certificate', 'TB test from approved clinic', true, 7, 'medical'),
  ('criminal_record', 'Criminal Record Certificate', 'Police clearance certificate from country of residence', true, 8, 'legal')
) AS x(document_type, document_name, description, is_required, sort_order, category) ON TRUE
WHERE LOWER(TRIM(vt."name")) = LOWER(TRIM('Skilled Worker Visa'))
ON CONFLICT DO NOTHING;

-- Student Visa checklist
INSERT INTO document_checklists (visa_type_id, document_type, document_name, description, is_required, sort_order, category)
SELECT vt.id, x.document_type, x.document_name, x.description, x.is_required, x.sort_order, x.category
FROM "visa_types" vt
JOIN (VALUES
  ('passport', 'Valid Passport', 'Passport must be valid for at least 6 months beyond intended stay', true, 1, 'identity'),
  ('english_certificate', 'English Language Certificate', 'IELTS or equivalent English language test result', true, 2, 'education'),
  ('cas', 'Confirmation of Acceptance for Studies', 'CAS number from educational institution', true, 3, 'legal'),
  ('academic_transcripts', 'Academic Transcripts', 'Previous academic qualifications', true, 4, 'education'),
  ('bank_statement', 'Bank Statements', 'Proof of funds for tuition and maintenance', true, 5, 'financial'),
  ('tuberculosis_test', 'Tuberculosis Test Certificate', 'TB test from approved clinic', true, 6, 'medical'),
  ('parental_consent', 'Parental Consent', 'For students under 18', false, 7, 'legal')
) AS x(document_type, document_name, description, is_required, sort_order, category) ON TRUE
WHERE LOWER(TRIM(vt."name")) = LOWER(TRIM('Student Visa'))
ON CONFLICT DO NOTHING;

-- Health & Care Worker Visa checklist
INSERT INTO document_checklists (visa_type_id, document_type, document_name, description, is_required, sort_order, category)
SELECT vt.id, x.document_type, x.document_name, x.description, x.is_required, x.sort_order, x.category
FROM "visa_types" vt
JOIN (VALUES
  ('passport', 'Valid Passport', 'Passport must be valid for at least 6 months beyond intended stay', true, 1, 'identity'),
  ('english_certificate', 'English Language Certificate', 'IELTS or equivalent English language test result', true, 2, 'education'),
  ('nmc_registration', 'NMC Registration', 'Nursing and Midwifery Council registration', true, 3, 'medical'),
  ('cos', 'Certificate of Sponsorship', 'Certificate of Sponsorship from employer', true, 4, 'legal'),
  ('qualification_certificate', 'Qualification Certificate', 'Relevant health qualification certificates', true, 5, 'education'),
  ('tuberculosis_test', 'Tuberculosis Test Certificate', 'TB test from approved clinic', true, 6, 'medical'),
  ('criminal_record', 'Criminal Record Certificate', 'Police clearance certificate', true, 7, 'legal')
) AS x(document_type, document_name, description, is_required, sort_order, category) ON TRUE
WHERE LOWER(TRIM(vt."name")) = LOWER(TRIM('Health & Care Worker Visa'))
ON CONFLICT DO NOTHING;
