/**
 * Seeds a default org-level Client Care Letter template (visa_type_id = NULL).
 *
 * Gives every tenant a complete, personalised CCL out of the box (with {{tags}} +
 * org logo) instead of falling back to the static .docx. Idempotent and
 * non-destructive: creates the default when the org has none, and upgrades an
 * existing default ONLY while it still matches a previous seeded version
 * (verbatim), so a caseworker/admin's own edits are never overwritten.
 */
import { Op } from "sequelize";
import logger from "../utils/logger.js";

const DEFAULT_NAME = "Default Client Care Letter";

// BUG-034: the client care letter shown was incomplete — it lacked the client's
// own details, the fee/disbursement breakdown, the client's responsibilities,
// timescales, confidentiality, a complaints route, cancellation terms and a
// signature block that a regulatory CCL is expected to contain. This is the full
// letter; it uses every relevant {{tag}} so it fills in per case.
const DEFAULT_BODY_HTML = `<p>{{date_today}}</p>
<p><strong>Private &amp; Confidential</strong></p>
<p>{{candidate_name}}<br/>{{candidate_address}}</p>
<p>Dear {{candidate_first_name}},</p>
<p><strong>Re: Client Care Letter &mdash; {{visa_type}} (Our reference: {{case_ref}})</strong></p>
<p>Thank you for instructing {{org_name}} to act on your behalf in connection with your {{visa_type}} application. This Client Care Letter sets out who will handle your matter, the work we will carry out, our fees, and the terms on which we act. Providing this information is a requirement of our regulator, the Immigration Advice Authority (IAA).</p>
<p><strong>Your details</strong></p>
<p>These are the details we currently hold for you. Please tell us straight away if anything is incorrect or changes.</p>
<ul>
<li>Full name: {{candidate_name}}</li>
<li>Date of birth: {{candidate_dob}}</li>
<li>Nationality: {{nationality}}</li>
<li>Passport number: {{passport_number}}</li>
<li>Email: {{candidate_email}}</li>
<li>Telephone: {{candidate_phone}}</li>
</ul>
<p><strong>Who will handle your matter</strong></p>
<p>Your matter will be handled by {{caseworker_name}}. If you have any questions at any time, please contact us at {{org_email}} or {{org_phone}}, quoting your reference {{case_ref}}.</p>
<p><strong>The work we will do for you</strong></p>
<p>The service we have agreed to provide covers:</p>
<ul>
<li>reviewing your circumstances and advising on your eligibility for the {{visa_type}};</li>
<li>reviewing the documents you provide and advising on any gaps;</li>
<li>preparing and submitting your application to the Home Office; and</li>
<li>corresponding with the Home Office on your behalf until a decision is made.</li>
</ul>
<p>Unless we agree otherwise in writing, our service does not include an appeal, administrative review, or a fresh application following a refusal.</p>
<p><strong>Our fees</strong></p>
<p>Our professional fee for this matter is {{fee_amount}} ({{amount_in_words}}). Payment is due as set out below:</p>
{{installment_plan}}
<p>Our professional fee does not include third-party costs (&ldquo;disbursements&rdquo;) such as the Home Office application fee, the Immigration Health Surcharge, biometric enrolment, document translation, or courier charges. These are payable in addition, and we will confirm the amounts before they are incurred. Where our fees are subject to VAT, VAT will be added at the prevailing rate.</p>
<p>Please make payment using the account details on your invoice, quoting your reference {{case_ref}}.</p>
<p><strong>Your responsibilities</strong></p>
<p>So that we can act effectively for you, you agree to give us full and accurate information, provide documents promptly when we request them, tell us of any change in your circumstances, and settle our invoices when they are due. We cannot be responsible for a delay or refusal caused by incomplete or inaccurate information.</p>
<p><strong>Timescales</strong></p>
<p>We will begin work once we have received a signed copy of this letter, your documents, and the first payment shown above. Home Office processing times vary; we will keep you updated on the progress of your matter and tell you of any decision as soon as we receive it.</p>
<p><strong>Confidentiality and data protection</strong></p>
<p>We treat your information as confidential and use it only to act on your matter, in line with data-protection law. We keep your file for the period required by our regulator and then securely destroy it, unless you ask us to return your original documents.</p>
<p><strong>If something goes wrong</strong></p>
<p>We aim to give you a high-quality service. If you are unhappy with any aspect of our service or our bill, please raise it with {{caseworker_name}} in the first instance, or write to us at {{org_email}}. We will acknowledge your complaint and respond to it promptly. If we are unable to resolve it, you may refer your complaint to our regulator, the Immigration Advice Authority (IAA).</p>
<p><strong>Cancellation</strong></p>
<p>You may end our retainer at any time by telling us in writing. You will remain responsible for our fees for the work done up to that point and for any disbursements already incurred on your behalf.</p>
<p><strong>Your agreement</strong></p>
<p>Please read this letter carefully. If you are happy to proceed on these terms, please sign and date below and return a copy to us. I confirm that I have read and understood this Client Care Letter and agree to instruct {{org_name}} on the terms set out above.</p>
<p>Signed: __________________________&nbsp;&nbsp;&nbsp;&nbsp;Date: ____________________</p>
<p>Name: {{candidate_name}}</p>
<p>Yours sincerely,</p>
<p>{{caseworker_name}}<br/>{{org_name}}</p>`;

// Previous seeded default bodies. An existing default whose body still matches one
// of these (ignoring surrounding whitespace) has NOT been customised, so it is
// safe to upgrade it to DEFAULT_BODY_HTML. Never remove entries — add new ones as
// the default evolves so older seeds keep upgrading cleanly.
const LEGACY_DEFAULT_BODIES = [
  `<p>{{date_today}}</p>
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
<p>{{caseworker_name}}<br/>{{org_name}}</p>`,
];

const normalise = (s) => String(s || "").replace(/\s+/g, " ").trim();

export async function seedCclTemplatesForDb(tenantDb) {
  if (!tenantDb?.CclTemplate) return;

  try {
    const existingDefault = await tenantDb.CclTemplate.findOne({
      where: { visaTypeId: { [Op.is]: null } },
    });

    if (!existingDefault) {
      await tenantDb.CclTemplate.create({
        name: DEFAULT_NAME,
        visaTypeId: null,
        bodyHtml: DEFAULT_BODY_HTML,
        headerHtml: null,
        footerHtml: null,
        isActive: true,
        createdBy: null,
      });
      return;
    }

    // BUG-034: upgrade the previously-seeded default to the complete letter, but
    // only while it is still one of our own un-edited seeds.
    const current = normalise(existingDefault.bodyHtml);
    const isUnedited = LEGACY_DEFAULT_BODIES.some((b) => normalise(b) === current);
    if (isUnedited && current !== normalise(DEFAULT_BODY_HTML)) {
      await existingDefault.update({ bodyHtml: DEFAULT_BODY_HTML });
      logger.info({ id: existingDefault.id }, "seedCclTemplatesForDb: upgraded default CCL to the complete letter");
    }
  } catch (err) {
    logger.warn({ err }, "seedCclTemplatesForDb");
  }
}

export default seedCclTemplatesForDb;
