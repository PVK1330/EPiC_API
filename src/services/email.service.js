import { sendTransactionalEmail } from "./mail.service.js";

/**
 * Low-level send. Use specific helpers below for account / transactional mail.
 */
export async function sendMail({ to, subject, html, text, organisationId = null }) {
  return sendTransactionalEmail({
    to,
    subject,
    html,
    text,
    organisationId,
  });
}

/**
 * Admin account creation (HTML from template utils).
 */
export async function sendAdminWelcomeEmail({ to, html, organisationId = null }) {
  return sendMail({
    to,
    subject: "Elite Pic - Admin Account Created",
    html,
    organisationId,
  });
}

/**
 * Caseworker account creation — credentials + login link.
 */
export async function sendCaseworkerWelcomeEmail({ to, html, organisationId = null }) {
  return sendMail({
    to,
    subject: "Elite Pic - Caseworker Account Created",
    html,
    organisationId,
  });
}

/**
 * Candidate account creation — credentials + login link.
 */
export async function sendCandidateWelcomeEmail({ to, html, organisationId = null }) {
  return sendMail({
    to,
    subject: "Elite Pic - Candidate Account Created",
    html,
    organisationId,
  });
}

/**
 * Case reschedule notification — date changes with reason.
 */
export async function sendRescheduleEmail({ to, html, organisationId = null }) {
  return sendMail({
    to,
    subject: "Elite Pic - Case Rescheduled",
    html,
    organisationId,
  });
}

/**
 * Appointment notification.
 */
export async function sendAppointmentEmail({ to, html, organisationId = null }) {
  return sendMail({
    to,
    subject: "Elite Pic - Appointment Scheduled",
    html,
    organisationId,
  });
}
