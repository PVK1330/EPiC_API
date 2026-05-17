-- Data Capture Sheet templates & submissions, Client Care Letter records

CREATE TABLE IF NOT EXISTS data_capture_templates (
  id SERIAL PRIMARY KEY,
  visa_type_id INTEGER REFERENCES visa_types(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL DEFAULT 'Data Capture Sheet',
  fields JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_capture_submissions (
  id SERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES data_capture_templates(id) ON DELETE SET NULL,
  responses JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(32) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  review_notes TEXT,
  submitted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (case_id)
);

CREATE TABLE IF NOT EXISTS case_ccl_records (
  id SERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL UNIQUE REFERENCES cases(id) ON DELETE CASCADE,
  status VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'issued', 'signed')),
  issued_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  signed_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  fee_amount DECIMAL(10, 2),
  issued_at TIMESTAMP,
  signed_at TIMESTAMP,
  issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dcs_case_id ON data_capture_submissions(case_id);
CREATE INDEX IF NOT EXISTS idx_dcs_user_id ON data_capture_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_dct_visa_type ON data_capture_templates(visa_type_id);
CREATE INDEX IF NOT EXISTS idx_ccl_case_id ON case_ccl_records(case_id);

-- Default global Data Capture Sheet fields (visa-specific rows can be added in admin later)
INSERT INTO data_capture_templates (visa_type_id, name, fields, is_active)
SELECT NULL, 'Standard Data Capture Sheet', '[
  {"key":"full_name","label":"Full legal name","type":"text","required":true},
  {"key":"date_of_birth","label":"Date of birth","type":"date","required":true},
  {"key":"nationality","label":"Nationality","type":"text","required":true},
  {"key":"passport_number","label":"Passport number","type":"text","required":true},
  {"key":"passport_expiry","label":"Passport expiry date","type":"date","required":true},
  {"key":"brp_number","label":"BRP / eVisa reference","type":"text","required":false},
  {"key":"driving_licence","label":"Driving licence number (if applicable)","type":"text","required":false},
  {"key":"current_address","label":"Current UK address","type":"textarea","required":true},
  {"key":"contact_email","label":"Contact email","type":"email","required":true},
  {"key":"contact_phone","label":"Contact phone","type":"text","required":true},
  {"key":"employment_details","label":"Employment / occupation details","type":"textarea","required":false},
  {"key":"additional_notes","label":"Additional information","type":"textarea","required":false}
]'::jsonb, TRUE
WHERE NOT EXISTS (SELECT 1 FROM data_capture_templates LIMIT 1);
