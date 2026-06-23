import logger from "../utils/logger.js";
import { recordAuditLog } from "./audit.service.js";
import {
  notifyUser,
  notifyAdmins,
  NotificationTypes,
  NotificationPriority,
} from "./notification.service.js";

/**
 * Generic sponsor-compliance review workflow, shared across:
 *   - Right-to-Work checks
 *   - Worker Events
 *   - Sponsor Change Requests
 *
 *   Submitted -> Under Review -> Approved | Rejected | Information Requested
 *   Information Requested -> Submitted   (sponsor responds / uploads evidence)
 *
 * Each entity carries its own review state in `reviewStatus` (+ reviewedBy /
 * reviewedAt / reviewNotes); every transition is recorded in
 * `compliance_review_history` and mirrored to the global audit log.
 */
export const REVIEW_STATUS = Object.freeze({
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  INFORMATION_REQUESTED: "Information Requested",
});

const TRANSITIONS = Object.freeze({
  [REVIEW_STATUS.SUBMITTED]: [
    REVIEW_STATUS.UNDER_REVIEW,
    REVIEW_STATUS.APPROVED,
    REVIEW_STATUS.REJECTED,
    REVIEW_STATUS.INFORMATION_REQUESTED,
  ],
  [REVIEW_STATUS.UNDER_REVIEW]: [
    REVIEW_STATUS.APPROVED,
    REVIEW_STATUS.REJECTED,
    REVIEW_STATUS.INFORMATION_REQUESTED,
  ],
  [REVIEW_STATUS.INFORMATION_REQUESTED]: [REVIEW_STATUS.SUBMITTED],
  [REVIEW_STATUS.APPROVED]: [],
  [REVIEW_STATUS.REJECTED]: [REVIEW_STATUS.UNDER_REVIEW],
});

export const REVIEW_ACTIONS = Object.freeze({
  REVIEW: "review",
  APPROVE: "approve",
  REJECT: "reject",
  REQUEST_INFO: "request_info",
  RESPOND: "respond",
});

const ACTION_TARGET = Object.freeze({
  review: REVIEW_STATUS.UNDER_REVIEW,
  approve: REVIEW_STATUS.APPROVED,
  reject: REVIEW_STATUS.REJECTED,
  request_info: REVIEW_STATUS.INFORMATION_REQUESTED,
  respond: REVIEW_STATUS.SUBMITTED,
});

/**
 * Supported entities, keyed by URL slug. `model` is the tenantDb model key,
 * `entityType` is the stable history discriminator, `evidenceField` is the
 * model attribute that stores an uploaded evidence path.
 */
export const REVIEW_ENTITIES = Object.freeze({
  "right-to-work": {
    model: "RightToWorkRecord",
    entityType: "right_to_work",
    label: "Right to Work check",
    evidenceField: "documentPath",
  },
  "worker-events": {
    model: "WorkerEvent",
    entityType: "worker_event",
    label: "Worker event",
    evidenceField: "evidenceFile",
  },
  "change-requests": {
    model: "SponsorChangeRequest",
    entityType: "change_request",
    label: "Change request",
    evidenceField: "evidenceFile",
  },
});

const httpError = (message, statusCode = 400, code = null) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
};

export function resolveEntity(slug) {
  const cfg = REVIEW_ENTITIES[slug];
  if (!cfg) throw httpError(`Unknown compliance entity: ${slug}`, 404);
  return cfg;
}

export function isTransitionAllowed(from, to) {
  // BUG-12 fix: when `from` is null, undefined, or any unknown value the
  // original code fell back to TRANSITIONS[SUBMITTED], inadvertently allowing
  // all SUBMITTED-origin transitions on uninitialized records. Unknown states
  // must be explicitly rejected.
  if (!Object.prototype.hasOwnProperty.call(TRANSITIONS, from)) return false;
  const allowed = TRANSITIONS[from];
  return from !== to && allowed.includes(to);
}

const orgOf = (record, req) =>
  record.organisationId ??
  (req?.user?.organisation_id != null ? Number(req.user.organisation_id) : null);

export async function loadRecord(tenantDb, cfg, id, extraWhere = {}) {
  return tenantDb[cfg.model].findOne({ where: { id, ...extraWhere } });
}

const reviewIncludes = (tenantDb) => [
  { model: tenantDb.User, as: "sponsor", attributes: ["id", "first_name", "last_name", "email"], required: false },
  { model: tenantDb.User, as: "reviewer", attributes: ["id", "first_name", "last_name", "email"], required: false },
];

export async function listForReview(tenantDb, cfg, { reviewStatus, sponsorId } = {}) {
  const where = {};
  if (reviewStatus && reviewStatus !== "All") where.reviewStatus = reviewStatus;
  if (sponsorId) where.sponsorId = Number(sponsorId);
  return tenantDb[cfg.model].findAll({
    where,
    include: reviewIncludes(tenantDb),
    order: [["created_at", "DESC"]],
  });
}

export async function getRecordWithHistory(tenantDb, cfg, id) {
  const record = await tenantDb[cfg.model].findByPk(id, { include: reviewIncludes(tenantDb) });
  if (!record) return null;
  const history = await getReviewHistory(tenantDb, cfg, id);
  return { record, history };
}

export async function getReviewHistory(tenantDb, cfg, id) {
  return tenantDb.ComplianceReviewHistory.findAll({
    where: { entityType: cfg.entityType, entityId: id },
    include: [{ model: tenantDb.User, as: "actor", attributes: ["id", "first_name", "last_name", "email"] }],
    order: [["created_at", "DESC"]],
  });
}

async function writeHistory({ tenantDb, cfg, record, actorId, action, previousStatus, newStatus, notes, req }) {
  const organisationId = orgOf(record, req);
  try {
    await tenantDb.ComplianceReviewHistory.create({
      entityType: cfg.entityType,
      entityId: record.id,
      actorId: actorId ?? null,
      organisationId: Number.isNaN(organisationId) ? null : organisationId,
      action,
      previousStatus,
      newStatus,
      notes: notes ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to write compliance review history");
  }
  recordAuditLog({
    tenantDb,
    userId: actorId ?? null,
    action: `COMPLIANCE_${cfg.entityType.toUpperCase()}_${String(action).toUpperCase()}`,
    resource: cfg.entityType,
    status: "Success",
    details: JSON.stringify({ entityId: record.id, previousStatus, newStatus, notes: notes ?? null }),
    req,
    organisationId: Number.isNaN(organisationId) ? null : organisationId,
  }).catch((err) => logger.error({ err }, "Failed to mirror compliance review audit"));
}

const REVIEW_NOTIFY = Object.freeze({
  review: { title: "Compliance item under review", type: NotificationTypes.INFO, priority: NotificationPriority.MEDIUM },
  approve: { title: "Compliance item approved", type: NotificationTypes.SUCCESS, priority: NotificationPriority.MEDIUM },
  reject: { title: "Compliance item rejected", type: NotificationTypes.ERROR, priority: NotificationPriority.HIGH },
  request_info: { title: "More information requested", type: NotificationTypes.WARNING, priority: NotificationPriority.HIGH },
});

async function notifySponsorOfReview({ tenantDb, cfg, record, action, newStatus, notes }) {
  const meta = REVIEW_NOTIFY[action] || { title: "Compliance item updated", type: NotificationTypes.INFO, priority: NotificationPriority.MEDIUM };
  try {
    await notifyUser(tenantDb, record.sponsorId, {
      type: meta.type,
      priority: meta.priority,
      title: meta.title,
      message: `Your ${cfg.label.toLowerCase()} (#${record.id}) is now ${String(newStatus).toLowerCase()}.${notes ? ` Note: ${notes}` : ""}`,
      category: "compliance",
      entityType: cfg.entityType,
      entityId: record.id,
      actionType: `compliance_${action}`,
      // Email on every reviewer decision (approve / reject / request_info).
      sendEmail: action === "approve" || action === "reject" || action === "request_info",
    });
  } catch (err) {
    logger.error({ err }, "Failed to notify sponsor of compliance review");
  }
}

/**
 * Reviewer (admin / caseworker) action: review | approve | reject | request_info.
 */
export async function applyReviewAction({ tenantDb, cfg, record, action, reviewerId, notes = null, req = null }) {
  const target = ACTION_TARGET[action];
  if (!target || action === REVIEW_ACTIONS.RESPOND) throw httpError("Invalid review action", 400);

  const previousStatus = record.reviewStatus || REVIEW_STATUS.SUBMITTED;
  if (!isTransitionAllowed(previousStatus, target)) {
    throw httpError(`Invalid transition: '${previousStatus}' -> '${target}'`, 409, "INVALID_TRANSITION");
  }

  record.reviewStatus = target;
  record.reviewedBy = reviewerId ?? null;
  record.reviewedAt = new Date();
  if (notes != null) record.reviewNotes = notes;
  await record.save();

  await writeHistory({ tenantDb, cfg, record, actorId: reviewerId, action, previousStatus, newStatus: target, notes, req });
  await notifySponsorOfReview({ tenantDb, cfg, record, action, newStatus: target, notes });

  return record;
}

/**
 * Sponsor action: respond to an information request (optionally with new
 * evidence). Moves the item back to Submitted for re-review.
 */
export async function sponsorRespond({ tenantDb, cfg, record, sponsorId, notes = null, evidencePath = null, req = null }) {
  const previousStatus = record.reviewStatus || REVIEW_STATUS.SUBMITTED;
  if (previousStatus !== REVIEW_STATUS.INFORMATION_REQUESTED) {
    throw httpError("You can only respond when information has been requested", 400);
  }

  if (evidencePath) record[cfg.evidenceField] = evidencePath;
  record.reviewStatus = REVIEW_STATUS.SUBMITTED;
  await record.save();

  await writeHistory({
    tenantDb, cfg, record, actorId: sponsorId,
    action: REVIEW_ACTIONS.RESPOND, previousStatus,
    newStatus: REVIEW_STATUS.SUBMITTED, notes, req,
  });

  try {
    await notifyAdmins(tenantDb, {
      type: NotificationTypes.INFO,
      priority: NotificationPriority.MEDIUM,
      title: `${cfg.label} re-submitted`,
      message: `A sponsor responded to an information request on a ${cfg.label.toLowerCase()} (#${record.id}) — ready for re-review.`,
      actionType: "compliance_respond",
      entityType: cfg.entityType,
      entityId: record.id,
    });
  } catch (err) {
    logger.error({ err }, "Failed to notify admins of compliance response");
  }

  return record;
}
