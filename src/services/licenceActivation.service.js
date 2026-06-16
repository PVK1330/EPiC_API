import logger from "../utils/logger.js";
import { recordAuditLog } from "./audit.service.js";
import {
  notifyUser,
  NotificationTypes,
  NotificationPriority,
} from "./notification.service.js";
import { sendTransactionalEmail } from "./mail.service.js";
import { generateNotificationEmailTemplate } from "../utils/emailTemplates.js";
import { recordLicenceAudit, extractCaseworkerIds } from "./licenceAssignment.service.js";
import { licenceActivatedCaseworkers } from "./sponsorshipNotification.service.js";

/** Standard UK sponsor licence validity. */
const LICENCE_VALIDITY_YEARS = 4;

export const LICENCE_STATUS = Object.freeze({
  ACTIVE: "Active",
  PENDING: "Pending",
  SUSPENDED: "Suspended",
  EXPIRED: "Expired",
});

/**
 * CoS allocation requests are stored as LicenceApplication rows whose `reason`
 * is prefixed "CoS Request:". They must NOT trigger licence activation — only a
 * genuine (New / Renewal) licence application does.
 */
export function isCosRequestApplication(application) {
  return String(application?.reason || "").startsWith("CoS Request:");
}

function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

/** Stable, collision-free licence number derived from the sponsor user id. */
function generateLicenceNumber(profile, application) {
  const year = new Date().getFullYear();
  const seed = profile.userId || application.userId;
  return `SLN-${year}-${String(seed).padStart(6, "0")}`;
}

/**
 * Phase 4 — Licence Activation.
 *
 * Activate (or renew) a sponsor's licence when their licence application is
 * approved:
 *   1. SponsorProfile.licenceStatus = Active
 *   2. generate licenceNumber (kept stable across renewals)
 *   3. store licence issue + expiry dates
 *   4. write a "Licence Approved" audit log (approved by / approved date)
 *   5. notify the sponsor (portal notification + email)
 *
 * Idempotent and safe to call again on a renewal. Returns
 * { profile, licenceNumber, wasActive } or null when no profile exists.
 */
export async function activateSponsorLicence({
  tenantDb,
  application,
  approvedByUserId = null,
  req = null,
  transaction = null,
}) {
  const profile = await tenantDb.SponsorProfile.findOne({
    where: { userId: application.userId },
    ...(transaction && { transaction }),
  });

  if (!profile) {
    logger.warn(
      { userId: application.userId, applicationId: application.id },
      "activateSponsorLicence: no SponsorProfile found for approved application"
    );
    return null;
  }

  const now = new Date();
  const issuedDate = now;
  const isRenewal = application.type === "Renewal";

  // ── Idempotency guard (ISSUE-006) ────────────────────────────────────────
  // A New/initial licence that is already Active with a licence number must
  // not be reactivated: doing so would overwrite the expiry date, re-seed the
  // CoS pool, and fire activation notifications a second time. Renewals are
  // the only legitimate re-entry — they intentionally extend the expiry.
  const alreadyActive =
    profile.licenceStatus === LICENCE_STATUS.ACTIVE && !!profile.sponsorLicenceNumber;
  if (alreadyActive && !isRenewal) {
    logger.warn(
      { applicationId: application.id, sponsorUserId: application.userId, licenceNumber: profile.sponsorLicenceNumber },
      "activateSponsorLicence: profile already Active — returning early (idempotency guard)"
    );
    return { profile, licenceNumber: profile.sponsorLicenceNumber, wasActive: true };
  }

  const licenceNumber =
    profile.sponsorLicenceNumber || generateLicenceNumber(profile, application);
  const wasActive = alreadyActive;

  // For renewals, extend from the existing expiry date so no time is lost
  // (or gained) due to processing lag. For new activations, start from now.
  const renewalBase = isRenewal && profile.licenceExpiryDate
    ? new Date(profile.licenceExpiryDate)
    : now;
  const expiryDate = addYears(renewalBase, LICENCE_VALIDITY_YEARS);

  // Seed initial CoS pool from the intake form's requested count, the
  // application's own cosAllocation field, or a safe default of 5.
  let seedCosPool = null;
  if (!profile.cosAllocation) {
    const intakeForm = await (tenantDb.LicenceIntakeForm?.findOne({
      where: { licenceApplicationId: application.id },
      attributes: ["numberOfCosRequired"],
      ...(transaction && { transaction }),
    }) ?? Promise.resolve(null)).catch(() => null);
    seedCosPool = intakeForm?.numberOfCosRequired || application.cosAllocation || 5;
  }

  // Activate the licence + seed the CoS pool.
  // When an external transaction is provided the caller owns commit/rollback;
  // otherwise we manage our own transaction so this function stays atomic
  // when called without an outer transaction (e.g. legacy callers, renewals).
  const ownTxn = !transaction;
  const t = transaction ?? await tenantDb.sequelize.transaction();
  try {
    profile.licenceStatus = LICENCE_STATUS.ACTIVE;
    profile.sponsorLicenceNumber = licenceNumber;
    profile.licenceIssueDate = issuedDate;
    profile.licenceExpiryDate = expiryDate;
    if (!profile.licenceRating) profile.licenceRating = "A";
    if (seedCosPool != null) profile.cosAllocation = seedCosPool;
    await profile.save({ transaction: t });
    if (ownTxn) await t.commit();
  } catch (err) {
    if (ownTxn) await t.rollback();
    throw err;
  }

  // 4) Audit log — Licence Approved / Approved By / Approved Date (best effort).
  await recordAuditLog({
    tenantDb,
    userId: approvedByUserId,
    action: "LICENCE_APPROVED",
    resource: "sponsor_licence",
    status: "Success",
    details: JSON.stringify({
      event: "Licence Approved",
      applicationId: application.id,
      sponsorUserId: application.userId,
      licenceNumber,
      approvedBy: approvedByUserId,
      approvedDate: now.toISOString(),
      issuedDate: issuedDate.toISOString(),
      expiryDate: expiryDate.toISOString(),
      renewal: wasActive,
    }),
    req,
    organisationId: profile.organisation_id ?? null,
  }).catch((err) =>
    logger.error({ err, applicationId: application.id, sponsorUserId: application.userId }, "Failed to record licence approval audit log")
  );

  // 4b) Timeline entry — LICENCE_ACTIVATED / LICENCE_RENEWED.
  await recordLicenceAudit({
    tenantDb,
    application,
    actorId: approvedByUserId,
    action: isRenewal ? "renewed" : "activated",
    previousStatus: null,
    newStatus: "Approved",
    notes: isRenewal
      ? `Licence renewed: ${licenceNumber}. New expiry: ${new Date(expiryDate).toLocaleDateString("en-GB")}. CoS pool: ${profile.cosAllocation ?? 0}.`
      : `Licence activated: ${licenceNumber}. CoS pool: ${profile.cosAllocation ?? 0}. Expires: ${new Date(expiryDate).toLocaleDateString("en-GB")}.`,
    req,
  }).catch((err) =>
    logger.error({ err, applicationId: application.id, sponsorUserId: application.userId }, "Failed to record licence timeline entry")
  );

  // 5) Notify the sponsor (portal + email).
  await notifySponsorLicenceActivated({
    tenantDb,
    profile,
    application,
    licenceNumber,
    issuedDate,
    expiryDate,
    isRenewal,
  });

  // 6) Notify assigned caseworkers (in-app).
  const cwIds = extractCaseworkerIds(application.assignedcaseworkerId);
  if (cwIds.length > 0) {
    await licenceActivatedCaseworkers({
      tenantDb,
      application,
      licenceNumber,
      cosAllocation: profile.cosAllocation ?? 0,
      caseworkerIds: cwIds,
      req,
    }).catch((err) =>
      logger.error({ err, applicationId: application.id, caseworkerIds: cwIds }, "Failed to notify caseworkers of licence activation")
    );
  }

  logger.info(
    {
      sponsorUserId: application.userId,
      licenceNumber,
      approvedBy: approvedByUserId,
    },
    "Sponsor licence activated"
  );

  return { profile, licenceNumber, wasActive };
}

/**
 * Deliver the activation notification two ways:
 *  - a persisted portal notification (in-app + socket), and
 *  - a guaranteed transactional email (independent of in-app preferences, since
 *    a licence grant is a critical transactional message).
 */
async function notifySponsorLicenceActivated({
  tenantDb,
  profile,
  application,
  licenceNumber,
  issuedDate,
  expiryDate,
  isRenewal = false,
}) {
  const userId = application.userId;
  const notifTitle = isRenewal ? "Sponsor Licence Renewed" : "Sponsor Licence Approved";
  const notifMessage = isRenewal
    ? `Your sponsor licence has been renewed (Licence No. ${licenceNumber}). New expiry: ${new Date(expiryDate).toLocaleDateString("en-GB")}.`
    : `Your sponsor licence is now Active (Licence No. ${licenceNumber}). You can now request CoS and sponsor workers.`;

  // Portal notification (sendEmail:false — the email is sent explicitly below).
  try {
    await notifyUser(tenantDb, userId, {
      type: NotificationTypes.SUCCESS,
      priority: NotificationPriority.HIGH,
      title: notifTitle,
      message: notifMessage,
      category: "licence",
      entityType: "licence_application",
      entityId: application.id,
      actionType: isRenewal ? "licence_renewed" : "licence_activated",
      sendEmail: false,
      metadata: {
        licenceNumber,
        issuedDate,
        expiryDate,
        licenceStatus: LICENCE_STATUS.ACTIVE,
        isRenewal,
      },
    });
  } catch (err) {
    logger.error({ err }, "Failed to create licence portal notification");
  }

  // Transactional email.
  try {
    let recipientEmail =
      profile.keyContactEmail ||
      profile.authorisingEmail ||
      profile.billingEmail ||
      null;
    if (!recipientEmail) {
      const user = await tenantDb.User.findByPk(userId, { attributes: ["email"] });
      recipientEmail = user?.email || null;
    }

    if (recipientEmail) {
      await sendTransactionalEmail({
        organisationId: profile.organisation_id ?? null,
        to: recipientEmail,
        subject: isRenewal
          ? `Your sponsor licence has been renewed — ${licenceNumber}`
          : `Your sponsor licence is now active — ${licenceNumber}`,
        html: generateNotificationEmailTemplate({
          recipientName: profile.companyName || "Sponsor",
          title: notifTitle,
          message: isRenewal
            ? `Congratulations — your sponsor licence has been successfully renewed.\n\n` +
              `Licence Number: ${licenceNumber}\n` +
              `Renewed On: ${new Date(issuedDate).toLocaleDateString("en-GB")}\n` +
              `New Expiry: ${new Date(expiryDate).toLocaleDateString("en-GB")}\n\n` +
              `Your CoS allocation and sponsorship rights remain in force.`
            : `Congratulations — your sponsor licence application has been approved and your licence is now ACTIVE.\n\n` +
              `Licence Number: ${licenceNumber}\n` +
              `Issued: ${new Date(issuedDate).toLocaleDateString("en-GB")}\n` +
              `Expires: ${new Date(expiryDate).toLocaleDateString("en-GB")}\n\n` +
              `You can now request Certificates of Sponsorship (CoS) and add sponsored workers.`,
          priority: NotificationPriority.HIGH,
          notificationType: NotificationTypes.SUCCESS,
          actionUrl: `${process.env.FRONTEND_URL || ""}/business/licence`,
          metadata: { licenceNumber },
        }),
      });
    } else {
      logger.warn({ userId }, "Licence notification: no email address found for sponsor");
    }
  } catch (err) {
    logger.error({ err }, "Failed to send licence email");
  }
}
