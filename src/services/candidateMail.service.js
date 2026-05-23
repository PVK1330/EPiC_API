import { sendTransactionalEmail } from "./mail.service.js";
import { generateCandidateWelcomeTemplate } from "../utils/emailTemplates.js";
import { resolveOrganisationLoginUrls } from "./tenantUserMail.service.js";

export async function sendCandidateWelcomeEmail({ user, plainPassword, organisationId }) {
  const { loginUrl, mainLoginUrl } = await resolveOrganisationLoginUrls(organisationId);

  const candidateName =
    [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || "Client";

  const html = generateCandidateWelcomeTemplate({
    candidateName,
    email: user.email,
    password: plainPassword,
    loginUrl,
    mainLoginUrl,
  });

  const result = await sendTransactionalEmail({
    organisationId,
    to: user.email,
    subject: "EPiC — Your account & visa enquiry access",
    html,
  });

  return { ...result, loginUrl };
}
