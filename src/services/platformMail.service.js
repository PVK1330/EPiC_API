import { sendTransactionalEmail } from "./mail.service.js";
import { generateAdminCredentialsTemplate } from "../utils/emailTemplates.js";

/**
 * Welcome email for platform staff (main URL login, not tenant subdomain).
 */
export async function sendPlatformStaffWelcomeEmail({ staff, plainPassword, roleName }) {
  const base =
    process.env.FRONTEND_URL?.split(",")[0]?.trim() || "http://localhost:5173";
  const loginUrl = `${base.replace(/\/$/, "")}/login`;
  const name = [staff.first_name, staff.last_name].filter(Boolean).join(" ").trim() || "Team member";

  const html = generateAdminCredentialsTemplate(staff.email, plainPassword, loginUrl);

  const result = await sendTransactionalEmail({
    organisationId: null,
    to: staff.email,
    subject: "Your EPiC platform staff account",
    html,
  });

  return { ...result, loginUrl };
}
