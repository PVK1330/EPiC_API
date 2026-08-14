import platformDb from "../models/index.js";
import { buildTenantFrontendUrls } from "../utils/organisationHost.js";
import { sendTransactionalEmail } from "./mail.service.js";
import {
  generateAdminCredentialsTemplate,
  generateCaseworkerWelcomeTemplate,
  generatePasswordResetOTPTemplate,
  generateSponsorWelcomeTemplate,
} from "../utils/emailTemplates.js";
import { getOrganisationEmailBranding } from "../utils/emailBranding.js";
import { wrapEpicEmail, credentialsBlockHtml, otpBlockHtml, esc as escapeHtml } from "../utils/epicEmailLayout.js";

// injection-xss-9/11: escape {{var}} values when the interpolation result is HTML
// (email body). Subjects are plain text, so escapeValues stays false there.
function interpolate(template, vars, escapeValues = false) {
  if (!template) return "";
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = vars[key] ?? "";
    return escapeValues ? escapeHtml(value) : value;
  });
}

/**
 * Look up an editable DB template and build the email HTML from it.
 * The body from the DB is used as the intro text; the styled block (credentials
 * or OTP) is always appended so the functional part can never be accidentally removed.
 * Returns null when no template is found — caller falls back to hardcoded.
 */
async function buildFromDbTemplate(tenantDb, templateKey, vars, styledBlock) {
  if (!tenantDb?.EmailTemplateSetting) return null;
  const row = await tenantDb.EmailTemplateSetting.findOne({
    where: { template_key: templateKey },
  }).catch(() => null);
  if (!row?.body) return null;

  const subject = interpolate(row.subject, vars);
  const messageHtml = interpolate(row.body, vars, true).replace(/\n/g, "<br>");
  const html = wrapEpicEmail({
    branding: vars._branding,
    pageTitle: subject,
    badge: vars._badge || "",
    title: subject,
    messageHtml,
    bodyHtml: styledBlock,
    ctaUrl: vars.login_url || null,
    ctaLabel: vars.login_url ? "Sign in to your portal" : "",
  });
  return { subject, html };
}

/**
 * Organisation-specific login URL (subdomain), e.g. http://acme.localhost:5173/login
 */
export async function resolveOrganisationLoginUrls(organisationId) {
  const fallbackBase =
    process.env.FRONTEND_URL?.split(",")[0]?.trim() || "http://localhost:5173";
  const fallback = `${fallbackBase.replace(/\/$/, "")}/login`;

  // Only return the main portal login URL
  return { 
    loginUrl: fallback, 
    mainLoginUrl: fallback 
  };
}

async function sendCredentialsMail({ to, subject, html, organisationId = null }) {
  return sendTransactionalEmail({ to, subject, html, organisationId });
}

export async function sendPasswordResetOtpEmail({ to, otp, organisationId = null, tenantDb = null }) {
  const branding = await getOrganisationEmailBranding(organisationId);
  const vars = { recipient_name: "", org_name: branding.orgName, _branding: branding, _badge: "Password Reset" };
  const fromDb = await buildFromDbTemplate(tenantDb, "password_reset", vars, otpBlockHtml(otp));
  const subject = fromDb?.subject ?? `${branding.orgName} — Password reset code`;
  const html = fromDb?.html ?? generatePasswordResetOTPTemplate(otp, branding);
  return sendTransactionalEmail({ to, subject, html, organisationId });
}

export async function sendTenantAdminWelcomeEmail({ user, plainPassword, organisationId, tenantDb = null }) {
  const { loginUrl, mainLoginUrl } = await resolveOrganisationLoginUrls(organisationId);
  const branding = await getOrganisationEmailBranding(organisationId);
  const recipientName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || "Admin";
  const vars = {
    recipient_name: recipientName, email: user.email, password: plainPassword,
    login_url: loginUrl, org_name: branding.orgName,
    _branding: branding, _badge: "Administrator",
  };
  const credBlock = credentialsBlockHtml({ email: user.email, password: plainPassword, loginUrl, mainLoginUrl, loginUrlLabel: "Admin Portal" });
  const fromDb = await buildFromDbTemplate(tenantDb, "welcome_org_admin", vars, credBlock);
  const subject = fromDb?.subject ?? `${branding.orgName} — Your admin account is ready`;
  const html = fromDb?.html ?? generateAdminCredentialsTemplate(user.email, plainPassword, loginUrl, mainLoginUrl, branding);
  const result = await sendCredentialsMail({ to: user.email, subject, html, organisationId });
  return { ...result, loginUrl };
}

export async function sendTenantCaseworkerWelcomeEmail({
  user, plainPassword, organisationId, firstName, tenantDb = null,
}) {
  const { loginUrl, mainLoginUrl } = await resolveOrganisationLoginUrls(organisationId);
  const branding = await getOrganisationEmailBranding(organisationId);
  const name = firstName || user.first_name || "Caseworker";
  const vars = {
    recipient_name: name, email: user.email, password: plainPassword,
    login_url: loginUrl, org_name: branding.orgName,
    _branding: branding, _badge: "Team Access",
  };
  const credBlock = credentialsBlockHtml({ email: user.email, password: plainPassword, loginUrl, mainLoginUrl });
  const fromDb = await buildFromDbTemplate(tenantDb, "welcome_caseworker", vars, credBlock);
  const subject = fromDb?.subject ?? `${branding.orgName} — Your caseworker account is ready`;
  const html = fromDb?.html ?? generateCaseworkerWelcomeTemplate({ name, email: user.email, password: plainPassword, loginUrl, mainLoginUrl, branding });
  const result = await sendCredentialsMail({ to: user.email, subject, html, organisationId });
  return { ...result, loginUrl };
}

export async function sendTenantSponsorWelcomeEmail({
  user, plainPassword, organisationId, firstName, tenantDb = null,
}) {
  const { loginUrl, mainLoginUrl } = await resolveOrganisationLoginUrls(organisationId);
  const branding = await getOrganisationEmailBranding(organisationId);
  const name = firstName || user.first_name || "Sponsor";
  const vars = {
    recipient_name: name, email: user.email, password: plainPassword,
    login_url: loginUrl, org_name: branding.orgName,
    _branding: branding, _badge: "Sponsor Access",
  };
  const credBlock = credentialsBlockHtml({ email: user.email, password: plainPassword, loginUrl, mainLoginUrl, loginUrlLabel: "Sponsor Portal" });
  const fromDb = await buildFromDbTemplate(tenantDb, "welcome_sponsor", vars, credBlock);
  const subject = fromDb?.subject ?? `${branding.orgName} — Your sponsor account is ready`;
  const html = fromDb?.html ?? generateSponsorWelcomeTemplate({ name, email: user.email, password: plainPassword, loginUrl, mainLoginUrl, branding });
  const result = await sendCredentialsMail({ to: user.email, subject, html, organisationId });
  return { ...result, loginUrl };
}
