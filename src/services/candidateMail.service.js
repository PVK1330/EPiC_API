import { sendTransactionalEmail } from "./mail.service.js";
import { generateCandidateWelcomeTemplate } from "../utils/emailTemplates.js";
import { getOrganisationEmailBranding } from "../utils/emailBranding.js";
import { wrapEpicEmail, credentialsBlockHtml, esc as escapeHtml } from "../utils/epicEmailLayout.js";
import { resolveOrganisationLoginUrls } from "./tenantUserMail.service.js";

// injection-xss-9/11: escape {{var}} values in HTML bodies; subjects stay raw
// (plain text) so escapeValues defaults to false.
function interpolate(template, vars, escapeValues = false) {
  if (!template) return "";
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = vars[key] ?? "";
    return escapeValues ? escapeHtml(value) : value;
  });
}

export async function sendCandidateWelcomeEmail({ user, plainPassword, organisationId, tenantDb = null }) {
  const { loginUrl, mainLoginUrl } = await resolveOrganisationLoginUrls(organisationId);
  const branding = await getOrganisationEmailBranding(organisationId);

  const candidateName =
    [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || "Client";

  let subject = `${branding.orgName} — Your account & visa enquiry access`;
  let html;

  if (tenantDb?.EmailTemplateSetting) {
    const row = await tenantDb.EmailTemplateSetting.findOne({
      where: { template_key: "welcome_candidate" },
    }).catch(() => null);

    if (row?.body) {
      const vars = {
        recipient_name: candidateName, email: user.email, password: plainPassword,
        login_url: loginUrl, org_name: branding.orgName,
      };
      subject = interpolate(row.subject, vars) || subject;
      const messageHtml = interpolate(row.body, vars, true).replace(/\n/g, "<br>");
      const credBlock = credentialsBlockHtml({ email: user.email, password: plainPassword, loginUrl, mainLoginUrl });
      html = wrapEpicEmail({
        branding,
        pageTitle: subject,
        badge: "Client Enquiry",
        title: subject,
        messageHtml,
        bodyHtml: credBlock,
        ctaUrl: loginUrl,
        ctaLabel: "Sign in & start visa enquiry",
      });
    }
  }

  if (!html) {
    html = generateCandidateWelcomeTemplate({ candidateName, email: user.email, password: plainPassword, loginUrl, mainLoginUrl, branding });
  }

  const result = await sendTransactionalEmail({ organisationId, to: user.email, subject, html });
  return { ...result, loginUrl };
}
