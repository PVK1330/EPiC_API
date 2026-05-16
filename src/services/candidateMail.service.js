import transporter from "../config/mail.js";
import { generateCandidateWelcomeTemplate } from "../utils/emailTemplates.js";
import { resolveOrganisationLoginUrl } from "./tenantUserMail.service.js";

export async function sendCandidateWelcomeEmail({ user, plainPassword, organisationId }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("EMAIL_USER/EMAIL_PASS not configured — candidate welcome email skipped");
    return { sent: false, reason: "mail_not_configured" };
  }

  const loginUrl = await resolveOrganisationLoginUrl(organisationId);

  const candidateName =
    [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || "Client";

  const html = generateCandidateWelcomeTemplate({
    candidateName,
    email: user.email,
    password: plainPassword,
    loginUrl,
  });

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: user.email,
    subject: "EPiC — Your account & visa enquiry access",
    html,
  });

  return { sent: true, loginUrl };
}
