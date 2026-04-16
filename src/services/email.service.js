import transporter from "../config/mail.js";

/**
 * Low-level send. Use specific helpers below for account / transactional mail.
 */
export async function sendMail({ to, subject, html, text }) {
  if (!process.env.EMAIL_USER) {
    console.warn("Email skipped: EMAIL_USER is not set");
    return { sent: false, skipped: true, reason: "not_configured" };
  }

  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;

  await transporter.sendMail({
    from,
    to,
    subject,
    html,
    text,
  });

  return { sent: true };
}

/**
 * Admin account creation (HTML from template utils).
 */
export async function sendAdminWelcomeEmail({ to, html }) {
  return sendMail({
    to,
    subject: "Elite Pic - Admin Account Created",
    html,
  });
}

/**
 * Caseworker account creation — credentials + login link.
 */
export async function sendCaseworkerWelcomeEmail({ to, html }) {
  return sendMail({
    to,
    subject: "Elite Pic - Caseworker Account Created",
    html,
  });
}

/**
 * Candidate account creation — credentials + login link.
 */
export async function sendCandidateWelcomeEmail({ to, html }) {
  return sendMail({
    to,
    subject: "Elite Pic - Candidate Account Created",
    html,
  });
}
