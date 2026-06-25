import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";
import logger from "../utils/logger.js";
import { validateTransition, WORKFLOW_TYPES } from "./workflowEngine.service.js";
import {
  recordLicenceAudit,
  LICENCE_AUDIT_ACTIONS,
  extractCaseworkerIds,
} from "./licenceAssignment.service.js";
import { completeStageTask, resolveRoleRecipients } from "./licenceStageTask.service.js";
import * as notify from "./sponsorshipNotification.service.js";
import { checkIntakeReadiness } from "./licenceIntake.service.js";

// ─── AES-256-GCM credential encryption ───────────────────────────────────────
// Key is derived from LICENCE_CRED_SECRET env var (must be set before first use).
// Stored format: <iv_hex>:<authTag_hex>:<ciphertext_hex>

function deriveKey() {
  const secret = process.env.LICENCE_CRED_SECRET;
  if (!secret) throw new Error("LICENCE_CRED_SECRET environment variable is not configured");
  return createHash("sha256").update(secret).digest();
}

export function encryptCredentialPassword(plaintext) {
  const key = deriveKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

export function decryptCredentialPassword(encrypted) {
  const key = deriveKey();
  const parts = String(encrypted).split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted credential format");
  const [ivHex, tagHex, ctHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ct = Buffer.from(ctHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// ─── Tracking row helper ──────────────────────────────────────────────────────

export async function getOrCreateTracking(tenantDb, licenceApplicationId) {
  const [row] = await tenantDb.LicenceGovernmentTracking.findOrCreate({
    where: { licenceApplicationId },
    defaults: { licenceApplicationId },
  });
  return row;
}

// ─── Caseworker: start review ─────────────────────────────────────────────────

export async function startReview(tenantDb, application, actorUser, req) {
  const actorId = actorUser?.userId ?? actorUser?.id ?? null;
  const previousStatus = application.status;

  const check = validateTransition(WORKFLOW_TYPES.LICENCE, previousStatus, "Under Review");
  if (!check.valid) {
    const err = new Error(check.message);
    err.statusCode = 400;
    throw err;
  }

  application.status = "Under Review";
  application.reviewStartedAt = new Date();
  await application.save();

  const caseworkerIds = extractCaseworkerIds(application.assignedcaseworkerId);

  await recordLicenceAudit({
    tenantDb,
    application,
    actorId,
    action: LICENCE_AUDIT_ACTIONS.REVIEW_STARTED,
    previousStatus,
    newStatus: "Under Review",
    req,
  });

  notify
    .reviewStarted({ tenantDb, application, caseworkerIds, req })
    .catch((err) => logger.error({ err }, "startReview: notification failed"));

  completeStageTask(tenantDb, {
    applicationId: application.id,
    stageKey: "sponsor_information_provision",
    role: "caseworker",
    actorUser,
    req,
  }).catch((err) => logger.warn({ err }, "startReview: completeStageTask failed"));

  return application.toJSON();
}

// ─── Caseworker: start government registration ────────────────────────────────

export async function startGovernmentRegistration(tenantDb, application, actorUser, req) {
  const actorId = actorUser?.userId ?? actorUser?.id ?? null;
  const previousStatus = application.status;

  // ── Intake readiness gate ──────────────────────────────────────────────────
  // Government Registration is blocked until the sponsor has completed the
  // information form AND all mandatory intake documents have been verified.
  const { isReady, reasons } = await checkIntakeReadiness(tenantDb, application.id);
  if (!isReady) {
    const err = new Error(`Cannot start Government Registration: ${reasons.join("; ")}`);
    err.statusCode = 400;
    err.reasons = reasons;
    throw err;
  }

  const check = validateTransition(WORKFLOW_TYPES.LICENCE, previousStatus, "Government Processing");
  if (!check.valid) {
    const err = new Error(check.message);
    err.statusCode = 400;
    throw err;
  }

  application.status = "Government Processing";
  await application.save();

  await getOrCreateTracking(tenantDb, application.id);

  await recordLicenceAudit({
    tenantDb,
    application,
    actorId,
    action: LICENCE_AUDIT_ACTIONS.GOVERNMENT_REGISTRATION_STARTED,
    previousStatus,
    newStatus: "Government Processing",
    req,
  });

  notify
    .governmentRegistrationStarted({ tenantDb, application, req })
    .catch((err) => logger.error({ err }, "startGovernmentRegistration: notification failed"));

  completeStageTask(tenantDb, {
    applicationId: application.id,
    stageKey: "sponsor_information_provision",
    role: "admin",
    actorUser,
    req,
  }).catch((err) => logger.warn({ err }, "startGovernmentRegistration: completeStageTask failed"));

  return application.toJSON();
}

// ─── Caseworker: complete government registration ─────────────────────────────

export async function completeGovernmentRegistration(tenantDb, application, actorUser, body, req) {
  const actorId = actorUser?.userId ?? actorUser?.id ?? null;
  const { smsRegistrationRef, governmentRegistrationRef } = body;

  const tracking = await getOrCreateTracking(tenantDb, application.id);
  tracking.smsRegistrationRef = smsRegistrationRef;
  if (governmentRegistrationRef) {
    tracking.governmentRegistrationRef = governmentRegistrationRef;
    application.governmentRegistrationRef = governmentRegistrationRef;
    await application.save();
  }
  await tracking.save();

  await recordLicenceAudit({
    tenantDb,
    application,
    actorId,
    action: LICENCE_AUDIT_ACTIONS.GOVERNMENT_REGISTRATION_COMPLETED,
    previousStatus: application.status,
    newStatus: application.status,
    notes: `SMS ref: ${smsRegistrationRef}`,
    req,
  });

  notify
    .governmentRegistrationCompleted({ tenantDb, application, smsRef: smsRegistrationRef, req })
    .catch((err) => logger.error({ err }, "completeGovernmentRegistration: notification failed"));

  completeStageTask(tenantDb, {
    applicationId: application.id,
    stageKey: "government_sms_registration",
    role: "caseworker",
    actorUser,
    req,
  }).catch((err) => logger.warn({ err }, "completeGovernmentRegistration: completeStageTask failed"));

  return { tracking: tracking.toJSON(), application: application.toJSON() };
}

// ─── Caseworker: prompt sponsor to submit their UKVI credentials ──────────────
// Flow v2: UKVI sends credentials to the sponsor's email directly.
// The caseworker sends a prompt to the sponsor reminding them to log in and
// submit those credentials via the portal. This sets credentialsSentAt (the
// "request sent" timestamp) and fires a notification email to the sponsor.

export async function requestGovernmentCredentials(tenantDb, application, actorUser, req) {
  const actorId = actorUser?.userId ?? actorUser?.id ?? null;

  const tracking = await getOrCreateTracking(tenantDb, application.id);
  tracking.credentialsSentAt = new Date();
  await tracking.save();

  await recordLicenceAudit({
    tenantDb,
    application,
    actorId,
    action: LICENCE_AUDIT_ACTIONS.CREDENTIALS_REQUESTED,
    previousStatus: application.status,
    newStatus: application.status,
    notes: "Caseworker prompted sponsor to submit UKVI portal credentials",
    req,
  });

  notify
    .governmentCredentialsRequested({ tenantDb, application, req })
    .catch((err) => logger.error({ err }, "requestGovernmentCredentials: notification failed"));

  // Activate the sponsor's government_portal_credentials stage task so it
  // surfaces as an active item in their task list and calendar immediately.
  tenantDb.LicenceStageTask.update(
    { status: "in_progress" },
    {
      where: {
        licenceApplicationId: application.id,
        stageKey: "government_portal_credentials",
        role: "sponsor",
        status: "pending",
      },
    },
  ).catch((err) =>
    logger.warn({ err }, "requestGovernmentCredentials: could not activate sponsor stage task"),
  );

  return { sent: true };
}

// ─── Caseworker: record government submission ─────────────────────────────────

export async function recordGovernmentSubmission(tenantDb, application, actorUser, body, req) {
  const actorId = actorUser?.userId ?? actorUser?.id ?? null;
  const { submissionRef, submissionDate } = body;
  const previousStatus = application.status;

  const check = validateTransition(WORKFLOW_TYPES.LICENCE, previousStatus, "Decision Pending");
  if (!check.valid) {
    const err = new Error(check.message);
    err.statusCode = 400;
    throw err;
  }

  application.status = "Decision Pending";
  application.governmentSubmissionRef = submissionRef;
  application.governmentSubmissionDate = submissionDate;
  await application.save();

  const tracking = await getOrCreateTracking(tenantDb, application.id);
  tracking.governmentSubmissionRef = submissionRef;
  tracking.governmentSubmissionDate = submissionDate;

  // Compute 5 working-day deadline for Home Office document dispatch.
  // "Working day" = Mon-Fri; skip weekends only (bank holidays not tracked).
  const deadline = new Date(submissionDate);
  let workingDaysAdded = 0;
  while (workingDaysAdded < 5) {
    deadline.setDate(deadline.getDate() + 1);
    const dow = deadline.getDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) workingDaysAdded++;
  }
  tracking.homeOfficeDocDeadline = deadline.toISOString().slice(0, 10);

  await tracking.save();

  await recordLicenceAudit({
    tenantDb,
    application,
    actorId,
    action: LICENCE_AUDIT_ACTIONS.GOVERNMENT_SUBMITTED,
    previousStatus,
    newStatus: "Decision Pending",
    notes: `Submission ref: ${submissionRef}`,
    req,
  });

  notify
    .governmentApplicationSubmitted({ tenantDb, application, submissionRef, req })
    .catch((err) => logger.error({ err }, "recordGovernmentSubmission: notification failed"));

  completeStageTask(tenantDb, {
    applicationId: application.id,
    stageKey: "government_submission",
    role: "caseworker",
    actorUser,
    req,
  }).catch((err) => logger.warn({ err }, "recordGovernmentSubmission: completeStageTask failed"));

  return application.toJSON();
}

// ─── Admin: generate credentials ──────────────────────────────────────────────

export async function generateCredentials(tenantDb, application, actorUser, body, req) {
  const actorId = actorUser?.userId ?? actorUser?.id ?? null;
  const { ukviPortalUserId, ukviPortalPassword, smsPortalUsername } = body;

  const encryptedPassword = encryptCredentialPassword(ukviPortalPassword);

  const tracking = await getOrCreateTracking(tenantDb, application.id);
  tracking.ukviPortalUserId = ukviPortalUserId;
  tracking.ukviPortalPasswordEncrypted = encryptedPassword;
  tracking.credentialsGeneratedAt = new Date();
  if (smsPortalUsername !== undefined) tracking.smsPortalUsername = smsPortalUsername;
  await tracking.save();

  const caseworkerIds = extractCaseworkerIds(application.assignedcaseworkerId);

  await recordLicenceAudit({
    tenantDb,
    application,
    actorId,
    action: LICENCE_AUDIT_ACTIONS.CREDENTIALS_GENERATED,
    previousStatus: application.status,
    newStatus: application.status,
    req,
  });

  notify
    .credentialsGenerated({ tenantDb, application, caseworkerIds, req })
    .catch((err) => logger.error({ err }, "generateCredentials: notification failed"));

  completeStageTask(tenantDb, {
    applicationId: application.id,
    stageKey: "government_portal_credentials",
    role: "admin",
    actorUser,
    req,
  }).catch((err) => logger.warn({ err }, "generateCredentials: completeStageTask failed"));

  // Return the tracking row without the encrypted password for safety.
  const result = tracking.toJSON();
  delete result.ukviPortalPasswordEncrypted;
  return { tracking: result };
}

// ─── Admin: resend credentials ────────────────────────────────────────────────

export async function resendCredentials(tenantDb, application, actorUser, req) {
  const actorId = actorUser?.userId ?? actorUser?.id ?? null;

  const tracking = await tenantDb.LicenceGovernmentTracking.findOne({
    where: { licenceApplicationId: application.id },
  });
  if (!tracking?.ukviPortalUserId || !tracking?.ukviPortalPasswordEncrypted) {
    const err = new Error("No credentials exist for this application — generate them first");
    err.statusCode = 400;
    throw err;
  }

  tracking.credentialsSentAt = new Date();
  await tracking.save();

  await recordLicenceAudit({
    tenantDb,
    application,
    actorId,
    action: LICENCE_AUDIT_ACTIONS.CREDENTIALS_REQUESTED,
    previousStatus: application.status,
    newStatus: application.status,
    notes: "Credentials re-sent to sponsor",
    req,
  });

  notify
    .governmentCredentialsRequested({ tenantDb, application, req })
    .catch((err) => logger.error({ err }, "resendCredentials: notification failed"));

  return { sent: true };
}

// ─── Sponsor: submit UKVI portal credentials (flow v2) ───────────────────────
// UKVI sends credentials to the sponsor's email. Sponsor enters them here and
// submits them to the case team. Caseworker/admin then review and confirm.

export async function submitUkviCredentials(tenantDb, application, actorUser, body, req) {
  const actorId = actorUser?.userId ?? actorUser?.id ?? null;
  const { ukviPortalUserId, ukviPortalPassword } = body;

  const encryptedPassword = encryptCredentialPassword(ukviPortalPassword);

  const tracking = await getOrCreateTracking(tenantDb, application.id);
  tracking.ukviPortalUserId = ukviPortalUserId;
  tracking.ukviPortalPasswordEncrypted = encryptedPassword;
  tracking.ukviCredentialsSubmittedAt = new Date();
  tracking.credentialsGeneratedAt = new Date(); // mark as "credentials on record"
  await tracking.save();

  const caseworkerIds = extractCaseworkerIds(application.assignedcaseworkerId);

  await recordLicenceAudit({
    tenantDb,
    application,
    actorId,
    action: LICENCE_AUDIT_ACTIONS.CREDENTIALS_RECEIVED,
    previousStatus: application.status,
    newStatus: application.status,
    notes: `Sponsor submitted UKVI portal credentials (user ID: ${ukviPortalUserId})`,
    req,
  });

  notify
    .credentialsGenerated({ tenantDb, application, caseworkerIds, req })
    .catch((err) => logger.error({ err }, "submitUkviCredentials: notify caseworker failed"));

  completeStageTask(tenantDb, {
    applicationId: application.id,
    stageKey: "government_portal_credentials",
    role: "sponsor",
    actorUser,
    req,
  }).catch((err) => logger.warn({ err }, "submitUkviCredentials: completeStageTask failed"));

  const result = tracking.toJSON();
  delete result.ukviPortalPasswordEncrypted;
  return { tracking: result };
}

// ─── Staff: view sponsor-submitted credentials (caseworker / admin) ──────────
// Decrypts and returns the credentials the sponsor submitted. Only available
// once ukviCredentialsSubmittedAt is set on the tracking row.

export async function getSubmittedCredentials(tenantDb, applicationId) {
  const tracking = await tenantDb.LicenceGovernmentTracking.findOne({
    where: { licenceApplicationId: applicationId },
  });
  if (!tracking) return null;
  if (!tracking.ukviCredentialsSubmittedAt) return null;

  const password = tracking.ukviPortalPasswordEncrypted
    ? decryptCredentialPassword(tracking.ukviPortalPasswordEncrypted)
    : null;

  return {
    ukviPortalUserId: tracking.ukviPortalUserId || null,
    ukviPortalPassword: password,
    smsPortalUsername: tracking.smsPortalUsername || null,
    submittedAt: tracking.ukviCredentialsSubmittedAt,
    caseworkerVerifiedAt: tracking.ukviCredentialsCaseworkerVerifiedAt || null,
    adminVerifiedAt: tracking.ukviCredentialsAdminVerifiedAt || null,
  };
}

// ─── Staff: request sponsor to resubmit credentials ──────────────────────────
// Clears ukviCredentialsSubmittedAt so the sponsor's stage task is reset and
// notifies them to resubmit.

export async function requestCredentialResubmission(tenantDb, application, actorUser, req) {
  const actorId = actorUser?.userId ?? actorUser?.id ?? null;

  const tracking = await getOrCreateTracking(tenantDb, application.id);
  tracking.ukviCredentialsSubmittedAt = null;
  tracking.credentialsSentAt = new Date();
  await tracking.save();

  await recordLicenceAudit({
    tenantDb,
    application,
    actorId,
    action: LICENCE_AUDIT_ACTIONS.CREDENTIALS_REQUESTED,
    previousStatus: application.status,
    newStatus: application.status,
    notes: "Staff requested sponsor to resubmit UKVI portal credentials",
    req,
  });

  notify
    .governmentCredentialsRequested({ tenantDb, application, req })
    .catch((err) => logger.error({ err }, "requestCredentialResubmission: notification failed"));

  return { requested: true };
}

// ─── Staff: verify/confirm credentials received (caseworker / admin) ─────────
// Completes the government_portal_credentials stage task for the given role.

export async function verifySubmittedCredentials(tenantDb, application, role, actorUser, req) {
  const actorId = actorUser?.userId ?? actorUser?.id ?? null;

  // Persist the verification timestamp so the staff credential panel can flip
  // its button to "Verified" and stay that way across reloads. Each reviewing
  // role records independently (the stage runs caseworker → admin).
  const tracking = await getOrCreateTracking(tenantDb, application.id);
  if (role === "admin") {
    tracking.ukviCredentialsAdminVerifiedAt = new Date();
  } else {
    tracking.ukviCredentialsCaseworkerVerifiedAt = new Date();
  }
  await tracking.save();

  await recordLicenceAudit({
    tenantDb,
    application,
    actorId,
    action: LICENCE_AUDIT_ACTIONS.CREDENTIALS_RECEIVED,
    previousStatus: application.status,
    newStatus: application.status,
    notes: `${role} confirmed UKVI portal credentials received and verified`,
    req,
  });

  completeStageTask(tenantDb, {
    applicationId: application.id,
    stageKey: "government_portal_credentials",
    role,
    actorUser,
    req,
  }).catch((err) => logger.warn({ err }, "verifySubmittedCredentials: completeStageTask failed"));

  // Notify the sponsor that their credentials were verified (best-effort).
  notify
    .credentialsVerified({ tenantDb, application, role, req })
    .catch((err) => logger.error({ err }, "verifySubmittedCredentials: sponsor notification failed"));

  return { verified: true };
}

// ─── Caseworker: confirm Home Office document dispatch (flow v2) ──────────────
// After UKVI submission, caseworker must dispatch physical supporting documents
// to the Home Office within 5 working days. This records the dispatch.

export async function confirmHomeOfficeDispatch(tenantDb, application, actorUser, body, req) {
  const actorId = actorUser?.userId ?? actorUser?.id ?? null;
  const { dispatchRef } = body;

  const tracking = await getOrCreateTracking(tenantDb, application.id);
  tracking.homeOfficeDocsSentAt = new Date();
  if (dispatchRef) tracking.homeOfficeDocsRef = dispatchRef;
  await tracking.save();

  await recordLicenceAudit({
    tenantDb,
    application,
    actorId,
    action: "HOME_OFFICE_DOCS_DISPATCHED",
    previousStatus: application.status,
    newStatus: application.status,
    notes: dispatchRef ? `Dispatch ref: ${dispatchRef}` : "Documents dispatched",
    req,
  });

  // Notify sponsor that their physical documents have been dispatched.
  // Caseworker/admin already know (they triggered this), so they're excluded.
  resolveRoleRecipients(tenantDb, application)
    .then(async (recipients) => {
      const company = application.companyName || `#LIC-${application.id}`;
      const refNote = dispatchRef ? ` (ref: ${dispatchRef})` : "";
      if (recipients.sponsor?.userId) {
        await notify.deliver({
          tenantDb,
          recipientUserId: recipients.sponsor.userId,
          type: "SUCCESS",
          priority: "HIGH",
          category: "sponsorship",
          title: "Supporting Documents Dispatched to Home Office",
          message: `Your supporting documents have been dispatched to the Home Office on your behalf${refNote} for ${company}. We will notify you once a UKVI decision has been received.`,
          entityType: "licence_application",
          entityId: application.id,
          actionType: "home_office_docs_dispatched",
          actionUrl: "/business/licence-process",
          req,
          organisationId: application.organisationId ?? null,
        });
      }
    })
    .catch((err) => logger.error({ err }, "confirmHomeOfficeDispatch: notification failed"));

  completeStageTask(tenantDb, {
    applicationId: application.id,
    stageKey: "home_office_document_dispatch",
    role: "caseworker",
    actorUser,
    req,
  }).catch((err) => logger.warn({ err }, "confirmHomeOfficeDispatch: completeStageTask failed"));

  return { dispatched: true, homeOfficeDocsSentAt: tracking.homeOfficeDocsSentAt, homeOfficeDocsRef: tracking.homeOfficeDocsRef };
}

// ─── Sponsor: confirm UKVI licence fee payment (flow v2) ─────────────────────
// Sponsor pays the fee directly on the UKVI portal (not to the organisation).
// They then confirm here so the case team is notified.

export async function confirmUkviPayment(tenantDb, application, actorUser, req) {
  const actorId = actorUser?.userId ?? actorUser?.id ?? null;

  application.ukviPaymentConfirmedAt = new Date();
  await application.save();

  const caseworkerIds = extractCaseworkerIds(application.assignedcaseworkerId);

  await recordLicenceAudit({
    tenantDb,
    application,
    actorId,
    action: "UKVI_PAYMENT_CONFIRMED",
    previousStatus: application.status,
    newStatus: application.status,
    notes: "Sponsor confirmed payment made on UKVI portal",
    req,
  });

  // Notify caseworkers + admin, and send a receipt to the sponsor.
  resolveRoleRecipients(tenantDb, application)
    .then(async (recipients) => {
      const company = application.companyName || `#LIC-${application.id}`;

      // Sponsor receipt — they're the actor so completeStageTask skips them in the stage notification
      if (recipients.sponsor?.userId) {
        await notify.deliver({
          tenantDb,
          recipientUserId: recipients.sponsor.userId,
          type: "SUCCESS",
          priority: "MEDIUM",
          category: "sponsorship",
          title: "UKVI Payment Confirmation Recorded",
          message: `Your UKVI licence fee payment confirmation has been recorded for ${company}. Your case team has been notified and will update your application once confirmed on their end.`,
          entityType: "licence_application",
          entityId: application.id,
          actionType: "ukvi_payment_confirmed",
          actionUrl: "/business/licence-process",
          req,
          organisationId: application.organisationId ?? null,
        });
      }

      // Staff notification
      const staffMsg = `${company} — the sponsor has confirmed payment of the UKVI licence fee on the UKVI portal. Please verify and confirm on your end.`;
      const staffTargets = [
        ...(recipients.admin ? [{ ...recipients.admin, url: "/admin/licence-applications" }] : []),
        ...recipients.caseworkers.map((cw) => ({ ...cw, url: "/caseworker/licence-reviews" })),
      ];
      for (const t of staffTargets) {
        await notify.deliver({
          tenantDb,
          recipientUserId: t.userId,
          type: "INFO",
          priority: "HIGH",
          category: "sponsorship",
          title: "UKVI Licence Fee — Payment Confirmed by Sponsor",
          message: staffMsg,
          entityType: "licence_application",
          entityId: application.id,
          actionType: "ukvi_payment_confirmed",
          actionUrl: t.url,
          req,
          organisationId: application.organisationId ?? null,
        });
      }
    })
    .catch((err) => logger.error({ err }, "confirmUkviPayment: notification failed"));

  completeStageTask(tenantDb, {
    applicationId: application.id,
    stageKey: "payment_confirmation",
    role: "sponsor",
    actorUser,
    req,
  }).catch((err) => logger.warn({ err }, "confirmUkviPayment: completeStageTask failed"));

  return { confirmed: true, ukviPaymentConfirmedAt: application.ukviPaymentConfirmedAt };
}

// ─── Sponsor: confirm credentials received ────────────────────────────────────

export async function confirmCredentialsReceived(tenantDb, application, actorUser, req) {
  const actorId = actorUser?.userId ?? actorUser?.id ?? null;

  const tracking = await tenantDb.LicenceGovernmentTracking.findOne({
    where: { licenceApplicationId: application.id },
  });
  if (!tracking) {
    const err = new Error("No government tracking record found for this application");
    err.statusCode = 404;
    throw err;
  }

  tracking.ukviCredentialsSubmittedAt = new Date();
  await tracking.save();

  await recordLicenceAudit({
    tenantDb,
    application,
    actorId,
    action: LICENCE_AUDIT_ACTIONS.CREDENTIALS_RECEIVED,
    previousStatus: application.status,
    newStatus: application.status,
    req,
  });

  notify
    .governmentCredentialsReceived({ tenantDb, application, req })
    .catch((err) => logger.error({ err }, "confirmCredentialsReceived: notification failed"));

  completeStageTask(tenantDb, {
    applicationId: application.id,
    stageKey: "government_portal_credentials",
    role: "sponsor",
    actorUser,
    req,
  }).catch((err) => logger.warn({ err }, "confirmCredentialsReceived: government_portal_credentials task failed"));

  completeStageTask(tenantDb, {
    applicationId: application.id,
    stageKey: "sponsor_portal_onboarding",
    role: "sponsor",
    actorUser,
    req,
  }).catch((err) => logger.warn({ err }, "confirmCredentialsReceived: sponsor_portal_onboarding task failed"));

  return { confirmed: true };
}
