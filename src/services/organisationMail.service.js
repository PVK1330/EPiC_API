import crypto from "crypto";
import transporter from "../config/mail.js";
import { generateOrganisationWelcomeTemplate } from "../utils/emailTemplates.js";
import { buildTenantFrontendUrls } from "../utils/organisationHost.js";

/**
 * Random password for new organisation admins (meets common policy rules).
 */
export function generateOrganisationAdminPassword(length = 14) {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%&*";
  const all = upper + lower + digits + special;

  const pick = (chars) => chars[crypto.randomInt(0, chars.length)];
  const required = [pick(upper), pick(lower), pick(digits), pick(special)];
  const rest = Array.from({ length: length - required.length }, () =>
    pick(all),
  );
  const combined = [...required, ...rest];
  for (let i = combined.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }
  return combined.join("");
}

/**
 * Send welcome email with login URL and temporary password.
 */
export async function sendOrganisationAdminWelcomeEmail({ organisation, admin, plainPassword }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("EMAIL_USER/EMAIL_PASS not configured — welcome email skipped");
    return { sent: false, reason: "mail_not_configured" };
  }

  const tenantUrls = buildTenantFrontendUrls(organisation.slug);
  const loginUrl = `${tenantUrls.subdomain.replace(/\/$/, "")}/login`;
  const adminName = [admin.first_name, admin.last_name].filter(Boolean).join(" ").trim() || "Admin";

  const html = generateOrganisationWelcomeTemplate({
    organisationName: organisation.name,
    adminName,
    email: admin.email,
    password: plainPassword,
    loginUrl,
    mainLoginUrl: tenantUrls.main,
  });

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: admin.email,
    subject: `Welcome to EPiC — ${organisation.name} is ready`,
    html,
  });

  return { sent: true, loginUrl, mainLoginUrl: tenantUrls.main };
}
