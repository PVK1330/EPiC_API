/**
 * Seeds a default org-level Client Care Letter template (visa_type_id = NULL).
 *
 * Gives every tenant a personalised CCL out of the box (with {{tags}} + org logo)
 * instead of falling back to the static .docx. Idempotent and non-destructive:
 * only creates the default when the org has no active default template yet, so
 * admin edits / custom templates are never overwritten.
 */
import { Op } from "sequelize";
import logger from "../utils/logger.js";

const DEFAULT_NAME = "Default Client Care Letter";

const DEFAULT_BODY_HTML = `<p>{{date_today}}</p>
<p>Dear {{candidate_name}},</p>
<p><strong>Re: Client Care Letter &mdash; {{visa_type}} (Case {{case_ref}})</strong></p>
<p>Thank you for instructing {{org_name}} to act on your behalf in connection with your {{visa_type}} application. This letter sets out the work we will carry out for you and our fees. This is a requirement of our regulator, the Immigration Advice Authority (IAA).</p>
<p><strong>Our fees</strong></p>
<p>Our professional fee for this matter is {{fee_amount}} ({{amount_in_words}}). Payment is due as set out below:</p>
{{installment_plan}}
<p><strong>The work we will do for you</strong></p>
<p>We will review your documents, prepare and submit your application, and correspond with the Home Office on your behalf until a decision is made.</p>
<p>Please read this letter carefully, sign where indicated, and return a signed copy to us. If you have any questions, please contact your caseworker, {{caseworker_name}}.</p>
<p>Yours sincerely,</p>
<p>{{caseworker_name}}<br/>{{org_name}}</p>`;

export async function seedCclTemplatesForDb(tenantDb) {
  if (!tenantDb?.CclTemplate) return;

  try {
    const existingDefault = await tenantDb.CclTemplate.findOne({
      where: { visaTypeId: { [Op.is]: null } },
    });
    if (existingDefault) return; // org already has a default (seeded or custom) — leave it

    await tenantDb.CclTemplate.create({
      name: DEFAULT_NAME,
      visaTypeId: null,
      bodyHtml: DEFAULT_BODY_HTML,
      headerHtml: null,
      footerHtml: null,
      isActive: true,
      createdBy: null,
    });
  } catch (err) {
    logger.warn({ err }, "seedCclTemplatesForDb");
  }
}

export default seedCclTemplatesForDb;
