import transporter from "../config/mail.js";
import platformDb from "../models/index.js";
import { buildTenantFrontendUrls } from "../utils/organisationHost.js";
import {
  generateAdminCredentialsTemplate,
  generateCaseworkerWelcomeTemplate,
  generateSponsorWelcomeTemplate,
} from "../utils/emailTemplates.js";

/**
 * Organisation-specific login URL (subdomain), e.g. http://acme.localhost:5173/login
 */
export async function resolveOrganisationLoginUrl(organisationId) {
  const fallbackBase =
    process.env.FRONTEND_URL?.split(",")[0]?.trim() || "http://localhost:5173";
  const fallback = `${fallbackBase.replace(/\/$/, "")}/login`;

  if (!organisationId) return fallback;

  const org = await platformDb.Organisation.findByPk(organisationId, {
    attributes: ["slug"],
  });
  if (!org?.slug) return fallback;

  const { subdomain } = buildTenantFrontendUrls(org.slug);
  return `${subdomain.replace(/\/$/, "")}/login`;
}

async function sendCredentialsMail({ to, subject, html }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("EMAIL_USER/EMAIL_PASS not configured — welcome email skipped");
    return { sent: false, reason: "mail_not_configured" };
  }

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject,
    html,
  });

  return { sent: true };
}

export async function sendTenantAdminWelcomeEmail({ user, plainPassword, organisationId }) {
  const loginUrl = await resolveOrganisationLoginUrl(organisationId);
  const html = generateAdminCredentialsTemplate(user.email, plainPassword, loginUrl);
  const result = await sendCredentialsMail({
    to: user.email,
    subject: "EPiC — Your admin account is ready",
    html,
  });
  return { ...result, loginUrl };
}

export async function sendTenantCaseworkerWelcomeEmail({
  user,
  plainPassword,
  organisationId,
  firstName,
}) {
  const loginUrl = await resolveOrganisationLoginUrl(organisationId);
  const html = generateCaseworkerWelcomeTemplate({
    name: firstName || user.first_name || "Caseworker",
    email: user.email,
    password: plainPassword,
    loginUrl,
  });
  const result = await sendCredentialsMail({
    to: user.email,
    subject: "EPiC — Your caseworker account is ready",
    html,
  });
  return { ...result, loginUrl };
}

export async function sendTenantSponsorWelcomeEmail({
  user,
  plainPassword,
  organisationId,
  firstName,
}) {
  const loginUrl = await resolveOrganisationLoginUrl(organisationId);
  const html = generateSponsorWelcomeTemplate({
    name: firstName || user.first_name || "Sponsor",
    email: user.email,
    password: plainPassword,
    loginUrl,
  });
  const result = await sendCredentialsMail({
    to: user.email,
    subject: "EPiC — Your sponsor account is ready",
    html,
  });
  return { ...result, loginUrl };
}
