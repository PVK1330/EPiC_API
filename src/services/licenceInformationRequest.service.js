import { Op } from "sequelize";
import logger from "../utils/logger.js";
import { recordLicenceAudit, LICENCE_AUDIT_ACTIONS } from "./licenceAssignment.service.js";
import * as sponsorshipNotify from "./sponsorshipNotification.service.js";
import { validateTransition, WORKFLOW_TYPES } from "./workflowEngine.service.js";

const ACTOR_ATTRS = ["id", "first_name", "last_name", "email"];

// Role IDs: 2=CASEWORKER, 3=ADMIN, 4=SPONSOR, 5=SUPERADMIN
function roleLabel(roleId) {
  const n = Number(roleId);
  if (n === 4) return "sponsor";
  if (n === 2) return "caseworker";
  return "admin";
}

function actorRoleLabel(actorUser) {
  return roleLabel(actorUser?.roleId ?? actorUser?.role_id);
}

const COMMENT_INCLUDES = (tenantDb) => [
  {
    model: tenantDb.LicenceInformationRequestComment,
    as: "comments",
    separate: true,
    order: [["created_at", "ASC"]],
    include: [{ model: tenantDb.User, as: "author", attributes: ACTOR_ATTRS, required: false }],
  },
];

const REQUEST_INCLUDES = (tenantDb) => [
  { model: tenantDb.User, as: "requestedBy", attributes: ACTOR_ATTRS, required: false },
  { model: tenantDb.User, as: "resolvedBy",  attributes: ACTOR_ATTRS, required: false },
  ...COMMENT_INCLUDES(tenantDb),
];

/**
 * Create a new information request.
 *
 * Transitions the application to "Information Requested" unless it is
 * already in that status (allows stacking multiple open requests).
 * Writes an audit row and notifies the sponsor.
 */
export async function createInfoRequest(
  tenantDb,
  { applicationId, subject, details, requestedDocuments, internalNote },
  actorUser,
  req,
) {
  // HIGH-005: Outer transaction — lock application, validate FSM, create info
  // request record, update application status, and write audit row atomically.
  // A process failure at any step rolls back all writes.
  const t = await tenantDb.sequelize.transaction();
  let application, infoRequest;
  try {
    // Lock the application row to prevent concurrent status changes.
    application = await tenantDb.LicenceApplication.findByPk(applicationId, {
      lock: true,
      transaction: t,
    });
    if (!application) {
      const e = new Error("Application not found"); e.statusCode = 404; throw e;
    }

    const previousStatus = application.status;
    const alreadyRequested = previousStatus === "Information Requested";

    if (!alreadyRequested) {
      const check = validateTransition(WORKFLOW_TYPES.LICENCE, previousStatus, "Information Requested");
      if (!check.valid) {
        const e = new Error(check.message); e.statusCode = 409; throw e;
      }
    }

    const now = new Date();

    infoRequest = await tenantDb.LicenceInformationRequest.create({
      licenceApplicationId: applicationId,
      requestedById: actorUser?.userId ?? null,
      status: "open",
      subject: String(subject).trim(),
      details: details?.trim() || null,
      requestedDocuments: Array.isArray(requestedDocuments) ? requestedDocuments : [],
      requestedAt: now,
    }, { transaction: t });

    // Seed optional internal note as the first comment (inside transaction).
    if (internalNote?.trim()) {
      await tenantDb.LicenceInformationRequestComment.create({
        licenceInformationRequestId: infoRequest.id,
        authorId: actorUser?.userId ?? null,
        authorRole: actorRoleLabel(actorUser),
        comment: internalNote.trim(),
        isInternal: true,
      }, { transaction: t });
    }

    const updates = { infoRequestedAt: now };
    if (!alreadyRequested) updates.status = "Information Requested";
    await application.update(updates, { transaction: t });

    // Audit write inside transaction — not best-effort.
    await recordLicenceAudit({
      tenantDb,
      application,
      actorId: actorUser?.userId ?? null,
      action: LICENCE_AUDIT_ACTIONS.REQUEST_INFO,
      previousStatus,
      newStatus: application.status,
      notes: `[Request #${infoRequest.id}] ${subject}`,
      req,
      transaction: t,
    });

    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }

  // Post-commit side-effect — best-effort.
  try {
    await sponsorshipNotify.informationRequested({
      tenantDb,
      application,
      adminNotes: details || subject,
      req,
    });
  } catch (err) {
    logger.error({ err, requestId: infoRequest.id }, "licenceInformationRequest: sponsor notify failed");
  }

  return infoRequest;
}

/**
 * List all information requests for an application, newest first.
 * Includes full comment threads and actor details.
 */
export async function listInfoRequests(tenantDb, applicationId) {
  return tenantDb.LicenceInformationRequest.findAll({
    where: { licenceApplicationId: applicationId },
    include: REQUEST_INCLUDES(tenantDb),
    order: [["created_at", "DESC"]],
  });
}

/**
 * Fetch a single request with its comments.
 * Returns null if not found or if it doesn't belong to the given application.
 */
export async function getInfoRequest(tenantDb, requestId, applicationId) {
  return tenantDb.LicenceInformationRequest.findOne({
    where: { id: requestId, licenceApplicationId: applicationId },
    include: REQUEST_INCLUDES(tenantDb),
  });
}

/**
 * Add a comment to an open or responded request.
 * - `isInternal` is forced to false for sponsor authors.
 * - Closed requests reject new comments.
 */
export async function addComment(
  tenantDb,
  { requestId, applicationId, authorId, authorRole, comment, isInternal = false },
) {
  const infoRequest = await tenantDb.LicenceInformationRequest.findOne({
    where: { id: requestId, licenceApplicationId: applicationId },
    attributes: ["id", "status"],
  });
  if (!infoRequest) {
    const e = new Error("Information request not found"); e.statusCode = 404; throw e;
  }
  if (infoRequest.status === "closed") {
    const e = new Error("Cannot comment on a closed request"); e.statusCode = 409; throw e;
  }
  const safeInternal = authorRole === "sponsor" ? false : Boolean(isInternal);

  return tenantDb.LicenceInformationRequestComment.create({
    licenceInformationRequestId: requestId,
    authorId,
    authorRole,
    comment: comment.trim(),
    isInternal: safeInternal,
  });
}

/**
 * Sponsor submits a response to an information request.
 *
 * - Sets request status → "responded" and records sponsorResponse text.
 * - Records respondedAt on the request and infoReceivedAt on the application.
 * - Appends the response text as a public (non-internal) comment.
 * - Notifies caseworkers / admin.
 */
export async function sponsorRespond(
  tenantDb,
  { applicationId, requestId, sponsorResponse },
  actorUser,
  req,
) {
  const application = await tenantDb.LicenceApplication.findByPk(applicationId);
  if (!application) {
    const e = new Error("Application not found"); e.statusCode = 404; throw e;
  }

  const infoRequest = await tenantDb.LicenceInformationRequest.findOne({
    where: { id: requestId, licenceApplicationId: applicationId },
  });
  if (!infoRequest) {
    const e = new Error("Information request not found"); e.statusCode = 404; throw e;
  }
  if (infoRequest.status === "closed") {
    const e = new Error("This request is already closed"); e.statusCode = 409; throw e;
  }

  const now = new Date();
  await infoRequest.update({
    status: "responded",
    sponsorResponse: sponsorResponse?.trim() || null,
    respondedAt: now,
  });

  if (sponsorResponse?.trim()) {
    await tenantDb.LicenceInformationRequestComment.create({
      licenceInformationRequestId: requestId,
      authorId: actorUser?.userId ?? null,
      authorRole: "sponsor",
      comment: sponsorResponse.trim(),
      isInternal: false,
    });
  }

  await application.update({ infoReceivedAt: now });

  await recordLicenceAudit({
    tenantDb,
    application,
    actorId: actorUser?.userId ?? null,
    action: LICENCE_AUDIT_ACTIONS.INFO_RESPONDED,
    previousStatus: application.status,
    newStatus: application.status,
    notes: `[Request #${requestId}] Sponsor responded`,
    req,
  });

  try {
    await sponsorshipNotify.informationReceived({ tenantDb, application, req });
  } catch (err) {
    logger.error({ err, requestId }, "licenceInformationRequest: staff notify on response failed");
  }

  return infoRequest;
}

/**
 * Caseworker or admin closes an information request.
 *
 * When the last open/responded request is closed the application automatically
 * transitions back to "Under Review" and a REVIEW_RESTARTED audit entry is written.
 */
export async function closeInfoRequest(
  tenantDb,
  { applicationId, requestId, closedById, notes },
  actorUser,
  req,
) {
  // Pre-flight: load without lock to validate existence / current state.
  // No write occurs here, so no lock is needed yet.
  const preCheck = await tenantDb.LicenceInformationRequest.findOne({
    where: { id: requestId, licenceApplicationId: applicationId },
    attributes: ["id", "status"],
  });
  if (!preCheck) {
    const e = new Error("Information request not found"); e.statusCode = 404; throw e;
  }
  if (preCheck.status === "closed") {
    const e = new Error("Request is already closed"); e.statusCode = 409; throw e;
  }

  // MED-004: Outer transaction — close request, optional note comment, close
  // audit, remaining-open count check, conditional review restart + audit,
  // all committed or rolled back together.  No partial state possible.
  const t = await tenantDb.sequelize.transaction();
  let application, infoRequest;
  try {
    // Lock both rows.
    application = await tenantDb.LicenceApplication.findByPk(applicationId, {
      lock: true,
      transaction: t,
    });
    if (!application) {
      const e = new Error("Application not found"); e.statusCode = 404; throw e;
    }

    infoRequest = await tenantDb.LicenceInformationRequest.findOne({
      where: { id: requestId, licenceApplicationId: applicationId },
      lock: true,
      transaction: t,
    });
    if (!infoRequest || infoRequest.status === "closed") {
      // Re-check inside transaction: someone may have closed it concurrently.
      const e = new Error(infoRequest ? "Request is already closed" : "Information request not found");
      e.statusCode = infoRequest ? 409 : 404;
      throw e;
    }

    const now = new Date();
    await infoRequest.update(
      { status: "closed", resolvedById: closedById, closedAt: now },
      { transaction: t }
    );

    if (notes?.trim()) {
      await tenantDb.LicenceInformationRequestComment.create({
        licenceInformationRequestId: requestId,
        authorId: closedById,
        authorRole: actorRoleLabel(actorUser),
        comment: notes.trim(),
        isInternal: true,
      }, { transaction: t });
    }

    await recordLicenceAudit({
      tenantDb,
      application,
      actorId: closedById,
      action: LICENCE_AUDIT_ACTIONS.INFO_REQUEST_CLOSED,
      previousStatus: application.status,
      newStatus: application.status,
      notes: `[Request #${requestId}] Closed${notes ? " — " + notes : ""}`,
      req,
      transaction: t,
    });

    // Count remaining open/responded requests inside the transaction so the
    // decision to restart review is based on the committed state, not a stale read.
    const remaining = await tenantDb.LicenceInformationRequest.count({
      where: {
        licenceApplicationId: applicationId,
        status: { [Op.in]: ["open", "responded"] },
        id: { [Op.ne]: requestId }, // exclude the row we just closed
      },
      transaction: t,
    });

    if (remaining === 0 && application.status === "Information Requested") {
      const previousStatus = application.status;

      const restartCheck = validateTransition(WORKFLOW_TYPES.LICENCE, previousStatus, "Under Review");
      if (!restartCheck.valid) {
        logger.error(
          { applicationId, previousStatus, message: restartCheck.message },
          "licenceInformationRequest: FSM rejected review-restart — rolling back"
        );
        // FSM rejection is treated as a hard error inside the transaction.
        const e = new Error(restartCheck.message); e.statusCode = 422; throw e;
      }

      await application.update({ status: "Under Review" }, { transaction: t });

      await recordLicenceAudit({
        tenantDb,
        application,
        actorId: closedById,
        action: LICENCE_AUDIT_ACTIONS.REVIEW_RESTARTED,
        previousStatus,
        newStatus: "Under Review",
        notes: "All information requests resolved — review restarted",
        req,
        transaction: t,
      });
    }

    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }

  // Post-commit side-effect — best-effort.
  if (application?.status === "Under Review") {
    try {
      await sponsorshipNotify.licenceStatusChanged({
        tenantDb,
        application,
        status: "Under Review",
        previousStatus: "Information Requested",
        req,
      });
    } catch (err) {
      logger.error({ err }, "licenceInformationRequest: sponsor review-restart notify failed");
    }
  }

  return infoRequest;
}
