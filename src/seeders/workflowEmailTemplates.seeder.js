/**
 * Standard workflow email templates (matches STAGE_EMAIL_TEMPLATE keys).
 *
 * These are DEFAULTS only — every org can edit subject/body from the admin panel
 * (Settings → Email Templates). Supported {{tags}} are interpolated at send time
 * by workflowEmail.service.js: client_name, case_ref, visa_type, firm_name,
 * caseworker_name, employer_name, biometrics_date, amount, portal_link,
 * data_capture_link, required_documents.
 *
 * Safe to run on every tenant provision: creates missing templates and upgrades
 * any that still hold a previous built-in default (legacyBodies) — admin-edited
 * templates are never overwritten.
 */
const WORKFLOW_EMAIL_TEMPLATES = [
  {
    template_key: "data_capture_request",
    subject: "[{{firm_name}}] Data Capture Sheet & Initial Documents Request",
    body: `Dear {{client_name}},

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
{{caseworker_name}}`,
    legacyBodies: [
      `Dear {{client_name}},

Please complete the Data Capture Sheet and return it with your passport, BRP/eVisa, and any other documents requested.

Kind regards,
{{caseworker_name}}`,
    ],
  },
  {
    template_key: "draft_application_review",
    subject: "[{{firm_name}}] Draft Application Review",
    body: `Dear {{client_name}},

Please find attached the draft version of your application form for your review.

Kindly review all details carefully. Please ensure all information is accurate and inform us immediately if any amendments or corrections are required.

Once you confirm that all details are correct, we will proceed with the submission of the application.

If you have any questions or require any clarification, please do not hesitate to contact us.

Kind regards,
{{caseworker_name}}`,
    legacyBodies: [
      `Dear {{client_name}},

Please review the draft application attached and confirm all details are correct.

Kind regards,
{{caseworker_name}}`,
    ],
  },
  {
    template_key: "ccl_issued",
    subject: "[{{firm_name}}] Client Care Letter",
    body: `Dear {{client_name}},

Please see attached a Client Care letter.

This letter outlines the work we are doing for you. This is a requirement of our Regulator, the Immigration Advice Authority (IAA).

Please can you read through the letter and then sign where indicated and then return a signed copy of the letter to us.

Please let us know if you have any questions.

Thank You.

Kind Regards,
{{caseworker_name}}`,
    legacyBodies: [
      `Dear {{client_name}},

Please find your Client Care Letter attached. Sign and return a copy at your earliest convenience.

Kind regards,
{{caseworker_name}}`,
    ],
  },
  {
    template_key: "biometrics_confirmation",
    subject: "[{{firm_name}}] Appointment Confirmation",
    body: `Hi {{client_name}},

Your visa application has been submitted and paid for, and your biometric appointment has been scheduled for {{biometrics_date}}.

Please familiarise yourself with the route and journey duration in advance to ensure you arrive at least 15 minutes before attending.

Please don't forget to take your:
- Appointment Confirmation
- Document Checklist
- Signed Consent Form
- Passport and most recent BRP

to the UKVCAS service point.

Please see enclosed a copy of your visa application form, appointment confirmation, document checklist, and payment receipts for the visa application, biometrics appointment and IHS for your reference.

I have also attached the consent form. Can you please complete just Part 1 of the attached Consent Declaration — kindly ensure all pages are scanned and sent back, then please take the original to the appointment.

As soon as I have received the signed consent letter, I will upload all relevant documents onto the case working system ahead of your appointment date.

If you have any questions or concerns, please let me know.

Thank you!

Kind Regards,
{{caseworker_name}}`,
    legacyBodies: [
      `Dear {{client_name}},

Your biometric appointment is scheduled for {{biometrics_date}}.

Kind regards,
{{caseworker_name}}`,
    ],
  },
  {
    template_key: "decision_communicated",
    subject: "[{{firm_name}}] Visa Decision",
    body: `Hi {{client_name}},

Hope you are well.

We are pleased to inform you regarding the decision on your {{visa_type}} application. Please refer to the details provided for further information.

{{employer_name}}, please ensure that a new right-to-work check is completed and saved in the records where applicable. Thank you.

If you have any queries, please let me know.

Kind Regards,
{{caseworker_name}}`,
    legacyBodies: [
      `Dear {{client_name}},

We are writing regarding the decision on your {{visa_type}} application.

Kind regards,
{{caseworker_name}}`,
    ],
  },
  {
    template_key: "case_closure",
    subject: "[{{firm_name}}] Case Closure Letter",
    body: `Hello {{client_name}},

Please find enclosed the case closure letter for your records. We kindly request that you review, sign, and return the document to us at your convenience.

It has truly been a pleasure assisting you, and we sincerely appreciate the opportunity to support you.

We would also be very grateful if you could take a moment to share your experience by leaving us a review on Google. Your feedback helps us improve our services and continue providing the best possible support to our clients.

Should you require any assistance in the future, please do not hesitate to contact us — we would be happy to help.

Thank you once again.

Kind regards,
{{caseworker_name}}`,
    legacyBodies: [
      `Dear {{client_name}},

Please find the case closure letter for your records.

Kind regards,
{{caseworker_name}}`,
    ],
  },
];

const norm = (s) => String(s || "").trim();

export async function seedWorkflowEmailTemplatesForDb(tenantDb) {
  if (!tenantDb?.EmailTemplateSetting) return;

  for (const tpl of WORKFLOW_EMAIL_TEMPLATES) {
    const [row, created] = await tenantDb.EmailTemplateSetting.findOrCreate({
      where: { template_key: tpl.template_key },
      defaults: {
        template_key: tpl.template_key,
        subject: tpl.subject,
        body: tpl.body,
      },
    });

    if (created || !row) continue;

    // Upgrade only when the stored content is empty or still matches a prior
    // built-in default — never overwrite an admin-customised template.
    const currentBody = norm(row.body);
    const legacySet = new Set((tpl.legacyBodies || []).map(norm));
    const bodyIsDefault = currentBody === "" || legacySet.has(currentBody);

    if (bodyIsDefault) {
      await row.update({ subject: tpl.subject, body: tpl.body });
    } else if (!norm(row.subject)) {
      await row.update({ subject: tpl.subject });
    }
  }
}

export default seedWorkflowEmailTemplatesForDb;
