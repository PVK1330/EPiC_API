-- Collapse legacy 18-step CCL stages into 16-step client_care_letter.
UPDATE cases
SET "caseStage" = 'client_care_letter'
WHERE "caseStage" IN (
  'ccl_fee_proposal',
  'ccl_fee_admin_review',
  'ccl_issued',
  'ccl_payment_received'
);
