import { UniqueConstraintError } from "sequelize";
import logger from "../utils/logger.js";
import {
  recordLicenceAudit,
  LICENCE_AUDIT_ACTIONS,
  extractCaseworkerIds,
} from "./licenceAssignment.service.js";
import { activateSponsorLicence } from "./licenceActivation.service.js";
import { validateTransition, WORKFLOW_TYPES } from "./workflowEngine.service.js";
import {
  licenceGranted as notifyLicenceGranted,
  licenceRejected as notifyLicenceRejected,
  licenceActivatedCaseworkers,
} from "./sponsorshipNotification.service.js";
import { ensureStageTasks } from "./licenceStageTask.service.js";

/**
 * Grant a sponsor licence.
 *
 * 1. Validates the transition to 'Licence Granted' (role-aware — admin/superadmin only).
 * 2. Activates the SponsorProfile (generates licence number, sets expiry, seeds CoS pool).
 * 3. Transitions the application status to 'Licence Granted'.
 * 4. Creates an immutable grant record in licence_grant_records.
 * 5. Writes an audit entry.
 * 6. Re-syncs stage tasks.
 * 7. Sends sponsor + caseworker notifications (best-effort).
 *
 * Throws with a `.statusCode` property on validation / not-found errors so the
 * controller can pass the right HTTP status code without catching class-by-class.
 */
export async function grantLicence(
  tenantDb,
  { applicationId, approvedById, notes, expiryDate, sponsorType, rating, cosAllocation },
  actorUser,
  req = null,
) {
  const actorRoleId = actorUser?.roleId ?? actorUser?.role_id;
  const actorId = approvedById ?? actorUser?.userId ?? null;

  // ── Outer transaction (ISSUE-001 / ISSUE-003) ─────────────────────────────
  // Everything that must succeed atomically is inside this transaction.
  // Side-effects (notifications, task sync) run after commit.
  const t = await tenantDb.sequelize.transaction();

  let application, grantRecord, activation;
  try {
    // Lock the row immediately so concurrent requests queue here (ISSUE-003).
    application = await tenantDb.LicenceApplication.findByPk(applicationId, {
      lock: true,
      transaction: t,
    });
    if (!application) {
      const err = new Error("Application not found");
      err.statusCode = 404;
      throw err;
    }

    const check = validateTransition(
      WORKFLOW_TYPES.LICENCE,
      application.status,
      "Licence Granted",
      { roleId: actorRoleId },
    );
    if (!check.valid) {
      const err = new Error(check.message);
      err.statusCode = 422;
      throw err;
    }

    const previousStatus = application.status;

    // Activate the SponsorProfile inside the same transaction (ISSUE-001).
    activation = await activateSponsorLicence({
      tenantDb,
      application,
      approvedByUserId: actorId,
      req,
      transaction: t,
    });

    const licenceNumber = activation?.licenceNumber ?? null;
    const resolvedExpiry = expiryDate ?? activation?.profile?.licenceExpiryDate ?? null;
    const resolvedRating = rating ?? activation?.profile?.licenceRating ?? "A";
    const resolvedCos = cosAllocation ?? activation?.profile?.cosAllocation ?? null;
    const resolvedSponsorType = sponsorType ?? null;

    application.status = "Licence Granted";
    await application.save({ transaction: t });

    // ISSUE-008: licenceApplicationId has a UNIQUE constraint; a second
    // concurrent grant attempt will throw UniqueConstraintError here.
    grantRecord = await tenantDb.LicenceGrantRecord.create({
      licenceApplicationId: applicationId,
      licenceNumber,
      approvedById: actorId,
      grantDate: new Date(),
      expiryDate: resolvedExpiry,
      sponsorType: resolvedSponsorType,
      rating: resolvedRating,
      cosAllocation: resolvedCos,
      notes: notes ?? null,
    }, { transaction: t });

    // Audit row — best-effort inside the transaction (swallowed errors do not
    // rollback; a failed audit must not block the grant itself).
    await recordLicenceAudit({
      tenantDb,
      application,
      actorId,
      action: LICENCE_AUDIT_ACTIONS.LICENCE_GRANTED,
      previousStatus,
      newStatus: "Licence Granted",
      notes: notes ?? (licenceNumber ? `Licence granted: ${licenceNumber}` : null),
      req,
      transaction: t,
    }).catch((err) =>
      logger.error({ err, applicationId }, "grantLicence: audit write failed")
    );

    await t.commit();
  } catch (err) {
    await t.rollback();

    // ISSUE-008: duplicate UniqueConstraintError → HTTP 409 instead of 500.
    if (err instanceof UniqueConstraintError) {
      const conflict = new Error(
        "This application has already been granted a licence. Duplicate grant requests are not permitted."
      );
      conflict.statusCode = 409;
      throw conflict;
    }

    throw err;
  }

  const licenceNumber = activation?.licenceNumber ?? null;
  const resolvedExpiry = expiryDate ?? activation?.profile?.licenceExpiryDate ?? null;
  const resolvedCos = cosAllocation ?? activation?.profile?.cosAllocation ?? null;

  // ── Post-commit side-effects (fire-and-forget) ───────────────────────────
  // Run these asynchronously so the HTTP response is not held pending SMTP or
  // notification delivery — a slow mailer was causing the frontend 10 s timeout
  // to fire before the response arrived, surfacing as "Action failed."
  ensureStageTasks(tenantDb, application).catch((err) =>
    logger.warn({ err, applicationId }, "grantLicence: ensureStageTasks failed")
  );

  notifyLicenceGranted({
    tenantDb,
    application,
    licenceNumber,
    expiryDate: resolvedExpiry,
    req,
  }).catch((err) => logger.warn({ err, applicationId }, "grantLicence: sponsor notification failed"));

  const cwIds = extractCaseworkerIds(application.assignedcaseworkerId);
  if (cwIds.length > 0) {
    licenceActivatedCaseworkers({
      tenantDb,
      application,
      licenceNumber,
      cosAllocation: resolvedCos ?? 0,
      caseworkerIds: cwIds,
      req,
    }).catch((err) =>
      logger.warn({ err, applicationId, cwIds }, "grantLicence: caseworker notification failed")
    );
  }

  logger.info({ applicationId, licenceNumber, actorId }, "Sponsor licence granted");
  return { application, grantRecord, licenceNumber, activation };
}

/**
 * Reject a sponsor licence application.
 *
 * 1. Validates the transition to 'Licence Rejected'.
 * 2. Stores the rejection reason on the application row.
 * 3. Transitions status to 'Licence Rejected'.
 * 4. Writes an audit entry.
 * 5. Re-syncs stage tasks.
 * 6. Sends sponsor notification (best-effort).
 */
export async function rejectLicence(
  tenantDb,
  { applicationId, rejectionReason, notes, rejectedById },
  actorUser,
  req = null,
) {
  // HIGH-002: Pre-flight validation (no DB write yet).
  if (!rejectionReason?.trim()) {
    const err = new Error("rejectionReason is required");
    err.statusCode = 400;
    throw err;
  }

  const actorId = rejectedById ?? actorUser?.userId ?? null;

  // ── Outer transaction (HIGH-002) ──────────────────────────────────────────
  // SELECT FOR UPDATE serialises concurrent grant/reject races on the same row.
  // Status update and audit row are committed together or rolled back together.
  // No audit divergence is possible.
  const t = await tenantDb.sequelize.transaction();
  let application;
  let previousStatus;

  try {
    // Lock the row so a concurrent grantLicence call queues behind us.
    application = await tenantDb.LicenceApplication.findByPk(applicationId, {
      lock: true,
      transaction: t,
    });
    if (!application) {
      const err = new Error("Application not found");
      err.statusCode = 404;
      throw err;
    }

    // Re-validate inside the transaction (status may have changed since the lock).
    const check = validateTransition(
      WORKFLOW_TYPES.LICENCE,
      application.status,
      "Licence Rejected",
    );
    if (!check.valid) {
      const err = new Error(check.message);
      err.statusCode = 422;
      throw err;
    }

    previousStatus = application.status;

    application.status = "Licence Rejected";
    application.rejectionReason = rejectionReason.trim();
    if (notes) application.adminNotes = notes;

    // UKVI policy: sponsor must wait 6 months before reapplying.
    const cooldown = new Date();
    cooldown.setMonth(cooldown.getMonth() + 6);
    application.rejectionCooldownUntil = cooldown.toISOString().slice(0, 10);

    await application.save({ transaction: t });

    // Audit write is inside the transaction — no longer best-effort.
    // If the audit INSERT fails the whole reject rolls back.
    await recordLicenceAudit({
      tenantDb,
      application,
      actorId,
      action: LICENCE_AUDIT_ACTIONS.LICENCE_REJECTED,
      previousStatus,
      newStatus: "Licence Rejected",
      notes: rejectionReason,
      req,
      transaction: t,
    });

    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }

  // ── Post-commit side-effects (best-effort) ────────────────────────────────
  await ensureStageTasks(tenantDb, application).catch((err) =>
    logger.warn({ err, applicationId }, "rejectLicence: ensureStageTasks failed")
  );

  await notifyLicenceRejected({
    tenantDb,
    application,
    adminNotes: rejectionReason,
    req,
  }).catch((err) => logger.warn({ err, applicationId }, "rejectLicence: notification failed"));

  logger.info({ applicationId, actorId, previousStatus }, "Sponsor licence rejected");
  return { application };
}

/**
 * Retrieve the grant record for an application, if it exists.
 * Returns null when the application has not been granted yet.
 */
export async function getGrantRecord(tenantDb, applicationId) {
  return tenantDb.LicenceGrantRecord.findOne({
    where: { licenceApplicationId: applicationId },
    include: [{ model: tenantDb.User, as: "approvedBy", attributes: ["id", "first_name", "last_name", "email"] }],
  });
}
