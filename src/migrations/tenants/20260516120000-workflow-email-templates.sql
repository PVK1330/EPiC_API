-- Workflow email templates (Standard Immigration Case Process)
INSERT INTO "email_templates" ("template_key", "subject", "body", "createdAt", "updatedAt")
SELECT t.k, t.s, t.b, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('data_capture_request', '[{{firm_name}}] Data Capture Sheet & Initial Documents Request', 'Dear {{client_name}},

I hope you are well.

Please find attached the Data Capture Sheet relating to your application. We would be grateful if you could kindly complete the form and return it to us at your earliest convenience.

In addition, please provide clear copies of the following documents:
- Passport
- BRP card
- eVisa share code
- Driving licence (if applicable)
- Previous Visa application form (if applicable)

We kindly ask that all documents provided are clear and legible to assist us with the preparation of your application and avoid any unnecessary delays.

Once we have received the completed Data Capture Sheet and supporting documents, we will begin preparing your application and will contact you should any further information be required.

If you have any questions or require any assistance completing the form, please do not hesitate to contact us. We will be happy to assist.

Kind regards,
{{caseworker_name}}'),
  ('draft_application_review', '[{{firm_name}}] Draft Application Review', 'Dear {{client_name}},

Please find attached the draft version of your application form for your review.

Kindly review all details carefully. Please ensure all information is accurate and inform us immediately if any amendments or corrections are required.

Once you confirm that all details are correct, we will proceed with the submission of the application.

If you have any questions or require any clarification, please do not hesitate to contact us.

Kind regards,
{{caseworker_name}}'),
  ('ccl_issued', '[{{firm_name}}] Client Care Letter', 'Dear {{client_name}},

Please see attached a Client Care letter.

This letter outlines the work we are doing for you. This is a requirement of our Regulator, the Immigration Advice Authority (IAA).

Please can you read through the letter and then sign where indicated and then return a signed copy of the letter to us.

Please let us know if you have any questions.

Thank You.

Kind Regards,
{{caseworker_name}}'),
  ('biometrics_confirmation', '[{{firm_name}}] Appointment Confirmation', 'Hi {{client_name}},

Your visa application has been submitted and paid for, and your biometric appointment has been scheduled for {{biometrics_date}}.

The appointment will take place at: TLScontact Manchester – UKVCAS Service Point (The Junction, Merchants Quay, Salford, M50 3SG, Manchester, United Kingdom)

Please familiarise yourself with the route and journey duration in advance to ensure you arrive at least 15 minutes before attending.

Please don''t forget to take your:
- Appointment Confirmation
- Document Checklist
- Signed Consent Form
- Passport and most recent BRP to UKVCAS service point.

See enclosed copy of visa application form, appointment confirmation, document checklist, and payment receipts for the visa application, biometrics appointment and IHS for your reference.

I have also attached the consent form. Can you please complete just Part 1 of the attached Consent Declaration - Kindly ensure all pages are scanned and sent back. Then please take the original to the appointment.

As soon as I have received the signed consent letter, I will upload all relevant documents onto the case working system ahead of your appointment date.

If you have any questions or concerns, please let me know.

Thankyou!

Kind Regards,
{{caseworker_name}}'),
  ('decision_communicated', '[{{firm_name}}] Visa Decision', 'Hi {{client_name}},

Hope you are well.

David has asked me to share this with you.

We are pleased to inform you that your {{visa_type}} application has been approved and is valid until 31 May 2029.

Please refer to the email below for further details.

{{employer_name}}, please ensure that a new right-to-work check is completed and saved in the records. Thank you.

If you have any queries, please let me know.

Kind Regards,
{{caseworker_name}}'),
  ('case_closure', '[{{firm_name}}] Case Closure Letter', 'Hello {{client_name}},

Please find enclosed the case closure letter for your records. We kindly request that you review, sign, and return the document to us at your convenience.

It has truly been a pleasure assisting you, and we sincerely appreciate the opportunity to support you.

We would also be very grateful if you could take a moment to share your experience by leaving us a review on Google. Your feedback helps us improve our services and continue providing the best possible support to our clients.

You may leave your review here:
https://g.page/r/CSl3-YESrzm_EAE/review

Should you require any assistance in the future, please do not hesitate to contact us, we would be happy to help.

Thank you once again.

Kind regards,
{{caseworker_name}}')
) AS t(k, s, b)
WHERE NOT EXISTS (
  SELECT 1 FROM "email_templates" e WHERE e."template_key" = t.k
);
