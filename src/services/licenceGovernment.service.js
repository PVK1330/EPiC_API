import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";
import logger from "../utils/logger.js";
import { validateTransition, WORKFLOW_TYPES } from "./workflowEngine.service.js";
import {
  recordLicenceAudit,
  LICENCE_AUDIT_ACTIONS,
  extractCaseworkerIds,
} from "./licenceAssignment.service.js";
import { completeStageTask } from "./licenceStageTask.service.js";
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

// ─── Caseworker: request government credentials ───────────────────────────────

export async function requestGovernmentCredentials(tenantDb, application, actorUser, req) {
  const actorId = actorUser?.userId ?? actorUser?.id ?? null;

  const tracking = await tenantDb.LicenceGovernmentTracking.findOne({
    where: { licenceApplicationId: application.id },
  });
  if (!tracking?.ukviPortalUserId || !tracking?.ukviPortalPasswordEncrypted) {
    const err = new Error("No credentials have been generated for this application yet");
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
    req,
  });

  // Decrypt password so the notification service can embed it in the credentials email.
  let plainPassword = null;
  try {
    plainPassword = decryptCredentialPassword(tracking.ukviPortalPasswordEncrypted);
  } catch (err) {
    logger.warn({ err }, "requestGovernmentCredentials: password decryption failed — email will omit password");
  }

  notify
    .governmentCredentialsRequested({ tenantDb, application, ukviPortalUserId: tracking.ukviPortalUserId, ukviPortalPassword: plainPassword, req })
    .catch((err) => logger.error({ err }, "requestGovernmentCredentials: notification failed"));

  completeStageTask(tenantDb, {
    applicationId: application.id,
    stageKey: "government_portal_credentials",
    role: "caseworker",
    actorUser,
    req,
  }).catch((err) => logger.warn({ err }, "requestGovernmentCredentials: completeStageTask failed"));

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
