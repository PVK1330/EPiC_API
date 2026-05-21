-- CCL fee proposal → admin approval → release to candidate (with instalments)

ALTER TABLE case_ccl_records DROP CONSTRAINT IF EXISTS case_ccl_records_status_check;

ALTER TABLE case_ccl_records
  ADD COLUMN IF NOT EXISTS installment_plan JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS proposed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS admin_reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_reviewed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS admin_review_notes TEXT;

ALTER TABLE case_ccl_records
  ADD CONSTRAINT case_ccl_records_status_check
  CHECK (status IN ('pending', 'fee_proposed', 'fee_rejected', 'issued', 'signed'));

-- Existing issued/signed rows remain valid
