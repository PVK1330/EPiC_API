-- Workflow email templates (Standard Immigration Case Process)
INSERT INTO "email_templates" ("template_key", "subject", "body", "createdAt", "updatedAt")
SELECT t.k, t.s, t.b, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('data_capture_request', '[{{firm_name}}] Data Capture Sheet & documents required', 'Dear {{client_name}},

Please complete the Data Capture Sheet for your {{visa_type}} application and upload your passport, BRP/eVisa, and driving licence (if applicable).

Case reference: {{case_ref}}

Best regards,
{{firm_name}}'),
  ('draft_application_review', '[{{firm_name}}] Draft application for your review', 'Dear {{client_name}},

Please review the draft application form attached and confirm your approval so we can proceed.

Case reference: {{case_ref}}

Best regards,
{{firm_name}}'),
  ('ccl_issued', '[{{firm_name}}] Client Care Letter', 'Dear {{client_name}},

Please find your Client Care Letter attached. Review the terms and fees, sign, and return with payment to proceed.

Case reference: {{case_ref}}

Best regards,
{{firm_name}}'),
  ('biometrics_confirmation', '[{{firm_name}}] Biometrics appointment confirmation', 'Dear {{client_name}},

Your biometrics appointment is confirmed. Please see the attached instructions and ensure supporting documents are uploaded before your appointment.

Appointment date: {{biometrics_date}}
Case reference: {{case_ref}}

Best regards,
{{firm_name}}'),
  ('decision_communicated', '[{{firm_name}}] Application decision', 'Dear {{client_name}},

We have received a decision on your application. Please see the attached decision documents.

Case reference: {{case_ref}}

Best regards,
{{firm_name}}'),
  ('case_closure', '[{{firm_name}}] Case closure', 'Dear {{client_name}},

Your immigration case {{case_ref}} is now closed. Thank you for choosing {{firm_name}}.

Best regards,
{{firm_name}}')
) AS t(k, s, b)
WHERE NOT EXISTS (
  SELECT 1 FROM "email_templates" e WHERE e."template_key" = t.k
);
