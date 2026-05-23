import platformDb from "../models/index.js";
import { buildTenantFrontendUrls } from "../utils/organisationHost.js";
import { sendTransactionalEmail } from "./mail.service.js";
import {
  generateAdminCredentialsTemplate,
  generateCaseworkerWelcomeTemplate,
  generatePasswordResetOTPTemplate,
  generateSponsorWelcomeTemplate,
} from "../utils/emailTemplates.js";

/**
 * Organisation-specific login URL (subdomain), e.g. http://acme.localhost:5173/login
 */
export async function resolveOrganisationLoginUrls(organisationId) {
  const fallbackBase =
    process.env.FRONTEND_URL?.split(",")[0]?.trim() || "http://localhost:5173";
  const fallback = `${fallbackBase.replace(/\/$/, "")}/login`;

  if (!organisationId) return { loginUrl: fallback, mainLoginUrl: fallback };

  const org = await platformDb.Organisation.findByPk(organisationId, {
    attributes: ["slug"],
  });
  if (!org?.slug) return { loginUrl: fallback, mainLoginUrl: fallback };

  const { subdomain } = buildTenantFrontendUrls(org.slug);
  return { 
    loginUrl: `${subdomain.replace(/\/$/, "")}/login`, 
    mainLoginUrl: fallback 
  };
}

async function sendCredentialsMail({ to, subject, html, organisationId = null }) {
  return sendTransactionalEmail({ to, subject, html, organisationId });
}

export async function sendPasswordResetOtpEmail({ to, otp, organisationId = null }) {
  return sendTransactionalEmail({
    to,
    subject: "EPiC — Password reset code",
    html: generatePasswordResetOTPTemplate(otp),
    organisationId,
  });
}

export async function sendTenantAdminWelcomeEmail({ user, plainPassword, organisationId }) {
  const { loginUrl, mainLoginUrl } = await resolveOrganisationLoginUrls(organisationId);
  const html = generateAdminCredentialsTemplate(user.email, plainPassword, loginUrl, mainLoginUrl);
  const result = await sendCredentialsMail({
    to: user.email,
    subject: "EPiC — Your admin account is ready",
    html,
    organisationId,
  });
  return { ...result, loginUrl };
}

export async function sendTenantCaseworkerWelcomeEmail({
  user,
  plainPassword,
  organisationId,
  firstName,
}) {
  const { loginUrl, mainLoginUrl } = await resolveOrganisationLoginUrls(organisationId);
  const html = generateCaseworkerWelcomeTemplate({
    name: firstName || user.first_name || "Caseworker",
    email: user.email,
    password: plainPassword,
    loginUrl,
    mainLoginUrl,
  });
  const result = await sendCredentialsMail({
    to: user.email,
    subject: "EPiC — Your caseworker account is ready",
    html,
    organisationId,
  });
  return { ...result, loginUrl };
}

export async function sendTenantSponsorWelcomeEmail({
  user,
  plainPassword,
  organisationId,
  firstName,
}) {
  const { loginUrl, mainLoginUrl } = await resolveOrganisationLoginUrls(organisationId);
  const html = generateSponsorWelcomeTemplate({
    name: firstName || user.first_name || "Sponsor",
    email: user.email,
    password: plainPassword,
    loginUrl,
    mainLoginUrl,
  });
  const result = await sendCredentialsMail({
    to: user.email,
    subject: "EPiC — Your sponsor account is ready",
    html,
    organisationId,
  });
  return { ...result, loginUrl };
}
