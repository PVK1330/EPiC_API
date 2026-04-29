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

-- Insert sample checklist items for common visa types
-- Note: These are sample data - visa_type_id values should match actual visa_types in your database

-- Skilled Worker Visa checklist
INSERT INTO document_checklists (visa_type_id, document_type, document_name, description, is_required, sort_order, category) VALUES
(1, 'passport', 'Valid Passport', 'Passport must be valid for at least 6 months beyond intended stay', true, 1, 'identity'),
(1, 'english_certificate', 'English Language Certificate', 'IELTS or equivalent English language test result', true, 2, 'education'),
(1, 'degree_certificate', 'Degree Certificate', 'Original degree certificate and transcripts', true, 3, 'education'),
(1, 'work_experience', 'Work Experience Letters', 'Employment letters for past 5 years', true, 4, 'work'),
(1, 'cos', 'Certificate of Sponsorship', 'Certificate of Sponsorship from employer', true, 5, 'legal'),
(1, 'bank_statement', 'Bank Statements', 'Proof of funds for maintenance', true, 6, 'financial'),
(1, 'tuberculosis_test', 'Tuberculosis Test Certificate', 'TB test from approved clinic', true, 7, 'medical'),
(1, 'criminal_record', 'Criminal Record Certificate', 'Police clearance certificate from country of residence', true, 8, 'legal')
ON CONFLICT DO NOTHING;

-- Student Visa checklist
INSERT INTO document_checklists (visa_type_id, document_type, document_name, description, is_required, sort_order, category) VALUES
(2, 'passport', 'Valid Passport', 'Passport must be valid for at least 6 months beyond intended stay', true, 1, 'identity'),
(2, 'english_certificate', 'English Language Certificate', 'IELTS or equivalent English language test result', true, 2, 'education'),
(2, 'cas', 'Confirmation of Acceptance for Studies', 'CAS number from educational institution', true, 3, 'legal'),
(2, 'academic_transcripts', 'Academic Transcripts', 'Previous academic qualifications', true, 4, 'education'),
(2, 'bank_statement', 'Bank Statements', 'Proof of funds for tuition and maintenance', true, 5, 'financial'),
(2, 'tuberculosis_test', 'Tuberculosis Test Certificate', 'TB test from approved clinic', true, 6, 'medical'),
(2, 'parental_consent', 'Parental Consent', 'For students under 18', false, 7, 'legal')
ON CONFLICT DO NOTHING;

-- Health & Care Worker Visa checklist
INSERT INTO document_checklists (visa_type_id, document_type, document_name, description, is_required, sort_order, category) VALUES
(3, 'passport', 'Valid Passport', 'Passport must be valid for at least 6 months beyond intended stay', true, 1, 'identity'),
(3, 'english_certificate', 'English Language Certificate', 'IELTS or equivalent English language test result', true, 2, 'education'),
(3, 'nmc_registration', 'NMC Registration', 'Nursing and Midwifery Council registration', true, 3, 'medical'),
(3, 'cos', 'Certificate of Sponsorship', 'Certificate of Sponsorship from employer', true, 4, 'legal'),
(3, 'qualification_certificate', 'Qualification Certificate', 'Relevant health qualification certificates', true, 5, 'education'),
(3, 'tuberculosis_test', 'Tuberculosis Test Certificate', 'TB test from approved clinic', true, 6, 'medical'),
(3, 'criminal_record', 'Criminal Record Certificate', 'Police clearance certificate', true, 7, 'legal')
ON CONFLICT DO NOTHING;
