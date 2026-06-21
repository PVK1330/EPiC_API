import { sendTransactionalEmail } from "./mail.service.js";
import { generateAdminCredentialsTemplate } from "../utils/emailTemplates.js";
import { getOrganisationEmailBranding } from "../utils/emailBranding.js";

/**
 * Welcome email for platform staff (main URL login, not tenant subdomain).
 * Platform-level: uses the platform identity branding (no tenant org).
 */
export async function sendPlatformStaffWelcomeEmail({ staff, plainPassword, roleName }) {
  const base =
    process.env.FRONTEND_URL?.split(",")[0]?.trim() || "http://localhost:5173";
  const loginUrl = `${base.replace(/\/$/, "")}/login`;

  const branding = await getOrganisationEmailBranding(null);
  const html = generateAdminCredentialsTemplate(staff.email, plainPassword, loginUrl, undefined, branding);

  const result = await sendTransactionalEmail({
    organisationId: null,
    to: staff.email,
    subject: `Your ${branding.orgName} platform staff account`,
    html,
  });

  return { ...result, loginUrl };
}
