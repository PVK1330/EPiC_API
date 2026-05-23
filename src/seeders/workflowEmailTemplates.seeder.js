/**
 * Standard workflow email templates (matches STAGE_EMAIL_TEMPLATE keys).
 * Safe to run on every tenant provision — uses findOrCreate per template_key.
 */
const WORKFLOW_EMAIL_TEMPLATES = [
  {
    template_key: "data_capture_request",
    subject: "[{{firm_name}}] Data Capture Sheet & Initial Documents Request",
    body: `Dear {{client_name}},

Please complete the Data Capture Sheet and return it with your passport, BRP/eVisa, and any other documents requested.

Kind regards,
{{caseworker_name}}`,
  },
  {
    template_key: "draft_application_review",
    subject: "[{{firm_name}}] Draft Application Review",
    body: `Dear {{client_name}},

Please review the draft application attached and confirm all details are correct.

Kind regards,
{{caseworker_name}}`,
  },
  {
    template_key: "ccl_issued",
    subject: "[{{firm_name}}] Client Care Letter",
    body: `Dear {{client_name}},

Please find your Client Care Letter attached. Sign and return a copy at your earliest convenience.

Kind regards,
{{caseworker_name}}`,
  },
  {
    template_key: "biometrics_confirmation",
    subject: "[{{firm_name}}] Biometric Appointment Confirmation",
    body: `Dear {{client_name}},

Your biometric appointment is scheduled for {{biometrics_date}}.

Kind regards,
{{caseworker_name}}`,
  },
  {
    template_key: "decision_communicated",
    subject: "[{{firm_name}}] Visa Decision",
    body: `Dear {{client_name}},

We are writing regarding the decision on your {{visa_type}} application.

Kind regards,
{{caseworker_name}}`,
  },
  {
    template_key: "case_closure",
    subject: "[{{firm_name}}] Case Closure",
    body: `Dear {{client_name}},

Please find the case closure letter for your records.

Kind regards,
{{caseworker_name}}`,
  },
];

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
    if (!created && row) {
      const emptySubject = !String(row.subject || "").trim();
      const emptyBody = !String(row.body || "").trim();
      if (emptySubject || emptyBody) {
        await row.update({
          subject: emptySubject ? tpl.subject : row.subject,
          body: emptyBody ? tpl.body : row.body,
        });
      }
    }
  }
}

export default seedWorkflowEmailTemplatesForDb;
