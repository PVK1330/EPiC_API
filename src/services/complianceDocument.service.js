import logger from "../utils/logger.js";
import { recordAuditLog } from "./audit.service.js";
import {
  notifyUser,
  NotificationTypes,
  NotificationPriority,
} from "./notification.service.js";

/**
 * Compliance Document review workflow.
 *
 *   draft ─▶ submitted ─▶ under_review ─▶ approved
 *                    │            │      ├▶ rejected
 *                    │            │      └▶ information_requested ─┐
 *                    │            └────────────────────────────────┤
 *                    └───────────────────(resubmit)◀───────────────┘
 *
 * Sponsors may only sit in the editable states (draft / submitted /
 * information_requested). Every move out of one state into another is performed
 * here so it is validated against {@link TRANSITIONS} and recorded in the
 * immutable `compliance_document_audits` table.
 */
export const COMPLIANCE_STATUS = Object.freeze({
  DRAFT: "draft",
  SUBMITTED: "submitted",
  UNDER_REVIEW: "under_review",
  APPROVED: "approved",
  REJECTED: "rejected",
  INFORMATION_REQUESTED: "information_requested",
});

/** Legacy statuses kept for historical rows; not produced by the new workflow. */
export const LEGACY_COMPLIANCE_STATUSES = Object.freeze([
  "valid",
  "expired",
  "missing",
]);

/** States a sponsor is still allowed to edit (before / around review). */
export const SPONSOR_EDITABLE_STATUSES = Object.freeze([
  COMPLIANCE_STATUS.DRAFT,
  COMPLIANCE_STATUS.SUBMITTED,
  COMPLIANCE_STATUS.INFORMATION_REQUESTED,
]);

/** States a sponsor must never delete (part of the compliance record). */
export const SPONSOR_UNDELETABLE_STATUSES = Object.freeze([
  COMPLIANCE_STATUS.UNDER_REVIEW,
  COMPLIANCE_STATUS.APPROVED,
]);

/** Allowed status transitions. A target absent here is rejected with 409. */
const TRANSITIONS = Object.freeze({
  draft: [COMPLIANCE_STATUS.SUBMITTED],
  submitted: [
    COMPLIANCE_STATUS.UNDER_REVIEW,
    COMPLIANCE_STATUS.APPROVED,
    COMPLIANCE_STATUS.REJECTED,
    COMPLIANCE_STATUS.INFORMATION_REQUESTED,
  ],
  under_review: [
    COMPLIANCE_STATUS.APPROVED,
    COMPLIANCE_STATUS.REJECTED,
    COMPLIANCE_STATUS.INFORMATION_REQUESTED,
  ],
  information_requested: [COMPLIANCE_STATUS.SUBMITTED],
  approved: [],
  rejected: [COMPLIANCE_STATUS.UNDER_REVIEW],
  // Legacy rows can be pulled into the workflow if ever re-reviewed.
  valid: [COMPLIANCE_STATUS.UNDER_REVIEW, COMPLIANCE_STATUS.SUBMITTED],
  expired: [COMPLIANCE_STATUS.SUBMITTED, COMPLIANCE_STATUS.UNDER_REVIEW],
  missing: [COMPLIANCE_STATUS.SUBMITTED, COMPLIANCE_STATUS.UNDER_REVIEW],
});

/** Reviewer (Admin / Caseworker) actions and the status each one produces. */
export const REVIEW_ACTIONS = Object.freeze({
  START_REVIEW: "start_review",
  APPROVE: "approve",
  REJECT: "reject",
  REQUEST_INFO: "request_info",
});

export const REVIEW_ACTION_TARGET = Object.freeze({
  [REVIEW_ACTIONS.START_REVIEW]: COMPLIANCE_STATUS.UNDER_REVIEW,
  [REVIEW_ACTIONS.APPROVE]: COMPLIANCE_STATUS.APPROVED,
  [REVIEW_ACTIONS.REJECT]: COMPLIANCE_STATUS.REJECTED,
  [REVIEW_ACTIONS.REQUEST_INFO]: COMPLIANCE_STATUS.INFORMATION_REQUESTED,
});

export function canSponsorEdit(status) {
  return SPONSOR_EDITABLE_STATUSES.includes(status);
}

export function canSponsorDelete(status) {
  return !SPONSOR_UNDELETABLE_STATUSES.includes(status);
}

export function isTransitionAllowed(from, to) {
  if (from === to) return false;
  const allowed = TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/** Error thrown for a disallowed transition; controllers map `code` to HTTP 409. */
export function invalidTransitionError(from, to) {
  const err = new Error(`Invalid status transition: '${from}' -> '${to}'`);
  err.code = "INVALID_TRANSITION";
  err.statusCode = 409;
  return err;
}

/**
 * Persist a single audit-trail row. Pass a transaction when called inside one.
 */
export async function writeComplianceAudit(
  {
    tenantDb,
    document,
    actorId = null,
    action,
    previousStatus = null,
    newStatus,
    notes = null,
    reviewedAt = null,
  },
  transaction = null
) {
  return tenantDb.ComplianceDocumentAudit.create(
    {
      complianceDocumentId: document.id,
      reviewerId: actorId,
      organisationId: document.organisationId ?? null,
      action,
      previousStatus,
      newStatus,
      notes,
      reviewedAt: reviewedAt || new Date(),
    },
    transaction ? { transaction } : {}
  );
}

/**
 * Atomically change a compliance document's status.
 *  - validates the transition,
 *  - updates the document (and reviewer fields when it is a review action),
 *  - writes an immutable audit-trail row,
 * all inside one transaction. A global audit-log entry is recorded afterwards
 * (best effort). Throws an INVALID_TRANSITION error for disallowed moves.
 *
 * @returns {Promise<{document: object, previousStatus: string, newStatus: string}>}
 */
export async function applyComplianceStatusChange({
  tenantDb,
  document,
  newStatus,
  actorId,
  action,
  notes = null,
  isReviewAction = false,
  req = null,
}) {
  const previousStatus = document.status;

  if (!isTransitionAllowed(previousStatus, newStatus)) {
    throw invalidTransitionError(previousStatus, newStatus);
  }

  const now = new Date();

  await tenantDb.sequelize.transaction(async (transaction) => {
    document.status = newStatus;
    if (isReviewAction) {
      document.reviewedBy = actorId ?? null;
      document.reviewedAt = now;
      document.lastReviewedDate = now;
      if (notes != null) document.reviewNotes = notes;
    }
    await document.save({ transaction });

    await writeComplianceAudit(
      {
        tenantDb,
        document,
        actorId: actorId ?? null,
        action,
        previousStatus,
        newStatus,
        notes,
        reviewedAt: now,
      },
      transaction
    );
  });

  // Global audit log — fire-and-forget so it never blocks the response.
  recordAuditLog({
    tenantDb,
    userId: actorId ?? null,
    action: `COMPLIANCE_DOCUMENT_${String(action).toUpperCase()}`,
    resource: "compliance_document",
    status: "Success",
    details: JSON.stringify({
      documentId: document.id,
      previousStatus,
      newStatus,
      notes: notes ?? null,
    }),
    req,
    organisationId: document.organisationId ?? null,
  }).catch((err) =>
    logger.error({ err }, "Failed to record compliance status audit log")
  );

  return { document, previousStatus, newStatus };
}

const REVIEW_NOTIFICATION = Object.freeze({
  [REVIEW_ACTIONS.START_REVIEW]: {
    title: "Compliance document under review",
    type: NotificationTypes.INFO,
    priority: NotificationPriority.MEDIUM,
  },
  [REVIEW_ACTIONS.APPROVE]: {
    title: "Compliance document approved",
    type: NotificationTypes.SUCCESS,
    priority: NotificationPriority.MEDIUM,
  },
  [REVIEW_ACTIONS.REJECT]: {
    title: "Compliance document rejected",
    type: NotificationTypes.ERROR,
    priority: NotificationPriority.HIGH,
  },
  [REVIEW_ACTIONS.REQUEST_INFO]: {
    title: "More information requested",
    type: NotificationTypes.WARNING,
    priority: NotificationPriority.HIGH,
  },
});

/** Notify the owning sponsor of a reviewer decision (best effort). */
export async function notifySponsorOfReview({
  tenantDb,
  document,
  action,
  newStatus,
  notes,
}) {
  const meta = REVIEW_NOTIFICATION[action] || {
    title: "Compliance document updated",
    type: NotificationTypes.INFO,
    priority: NotificationPriority.MEDIUM,
  };
  const readable = String(newStatus).replace(/_/g, " ");
  try {
    await notifyUser(tenantDb, document.sponsorId, {
      type: meta.type,
      priority: meta.priority,
      title: meta.title,
      message: `Your document "${document.documentType}" is now ${readable}.${notes ? ` Note: ${notes}` : ""}`,
      category: "compliance",
      entityType: "compliance_document",
      entityId: document.id,
      actionType: `compliance_${action}`,
      sendEmail: true,
    });
  } catch (err) {
    logger.error({ err }, "Failed to notify sponsor of compliance review");
  }
}
