import { sendTransactionalEmail } from "./mail.service.js";
import { generateCandidateWelcomeTemplate } from "../utils/emailTemplates.js";
import { getOrganisationEmailBranding } from "../utils/emailBranding.js";
import { resolveOrganisationLoginUrls } from "./tenantUserMail.service.js";

export async function sendCandidateWelcomeEmail({ user, plainPassword, organisationId }) {
  const { loginUrl, mainLoginUrl } = await resolveOrganisationLoginUrls(organisationId);
  const branding = await getOrganisationEmailBranding(organisationId);

  const candidateName =
    [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || "Client";

  const html = generateCandidateWelcomeTemplate({
    candidateName,
    email: user.email,
    password: plainPassword,
    loginUrl,
    mainLoginUrl,
    branding,
  });

  const result = await sendTransactionalEmail({
    organisationId,
    to: user.email,
    subject: `${branding.orgName} — Your account & visa enquiry access`,
    html,
  });

  return { ...result, loginUrl };
}
