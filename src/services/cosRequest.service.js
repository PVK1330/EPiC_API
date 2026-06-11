import { Op } from "sequelize";
import logger from "../utils/logger.js";
import { recordAuditLog } from "./audit.service.js";
import {
  notifyUser,
  notifyAdmins,
  NotificationTypes,
  NotificationPriority,
} from "./notification.service.js";

/**
 * CoS Request workflow — single source of truth.
 *
 *   Sponsor requests CoS  ->  Pending
 *                              -> (admin assigns caseworker) Under Review
 *                              -> Approved | Rejected
 *                              -> on Approved: sponsor allocation incremented
 */
export const COS_STATUS = Object.freeze({
  PENDING: "Pending",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
});

/** Statuses a sponsor may still edit/withdraw. */
const SPONSOR_MUTABLE = [COS_STATUS.PENDING, COS_STATUS.UNDER_REVIEW];
/** Statuses a reviewer may act on. */
const REVIEWABLE = [COS_STATUS.PENDING, COS_STATUS.UNDER_REVIEW];
const INACTIVE_CASE = ["Rejected", "Cancelled", "Closed"];

const toInt = (v, fallback = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

const httpError = (message, statusCode = 400, code = null) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
};

/** Normalise the assigned-caseworker JSONB list to positive integers. */
export function extractCaseworkerIds(value) {
  let list = value;
  if (!Array.isArray(list)) {
    if (list == null) return [];
    list = [list];
  }
  return list
    .map((entry) => {
      if (typeof entry === "number") return entry;
      if (typeof entry === "string" && entry.trim() !== "" && !Number.isNaN(Number(entry))) {
        return Number(entry);
      }
      if (entry && typeof entry === "object") {
        const id = entry.id ?? entry.userId ?? entry.caseworkerId ?? null;
        return id != null ? Number(id) : null;
      }
      return null;
    })
    .filter((id) => Number.isInteger(id) && id > 0);
}

export function isCaseworkerAssignedToCos(request, caseworkerId) {
  return extractCaseworkerIds(request?.assignedCaseworkerIds).includes(Number(caseworkerId));
}

async function auditCos({ tenantDb, request, actorId, action, details = {}, req = null }) {
  recordAuditLog({
    tenantDb,
    userId: actorId ?? null,
    action: `COS_REQUEST_${String(action).toUpperCase()}`,
    resource: "cos_request",
    status: "Success",
    details: JSON.stringify({ cosRequestId: request.id, sponsorId: request.sponsorId, ...details }),
    req,
    organisationId: request.organisationId ?? null,
  }).catch((err) => logger.error({ err }, "Failed to record CoS audit log"));
}

const sponsorInclude = (tenantDb) => [
  { model: tenantDb.User, as: "sponsor", attributes: ["id", "first_name", "last_name", "email"] },
  { model: tenantDb.User, as: "reviewer", attributes: ["id", "first_name", "last_name", "email"] },
];

// ─── Sponsor operations ───────────────────────────────────────────────────────

export async function createCosRequest({ tenantDb, sponsorId, organisationId, visaType, requestedAmount, reason, req = null }) {
  if (!visaType || requestedAmount == null || !reason) {
    throw httpError("visaType, requestedAmount and reason are required", 400);
  }
  const amount = toInt(requestedAmount);
  if (amount <= 0) throw httpError("requestedAmount must be a positive number", 400);

  const profile = await tenantDb.SponsorProfile.findOne({ where: { userId: sponsorId } });

  const request = await tenantDb.CosRequest.create({
    sponsorId,
    organisationId: organisationId ?? profile?.organisation_id ?? null,
    visaType,
    requestedAmount: amount,
    reason,
    status: COS_STATUS.PENDING,
  });

  await auditCos({ tenantDb, request, actorId: sponsorId, action: "created", details: { requestedAmount: amount, visaType }, req });

  const company = profile?.companyName || `Sponsor #${sponsorId}`;
  try {
    await notifyAdmins(tenantDb, {
      type: NotificationTypes.INFO,
      priority: NotificationPriority.HIGH,
      title: `CoS Request: ${company}`,
      message: `${company} requested ${amount} CoS for ${visaType}. Reason: ${reason}`,
      actionType: "cos_request",
      entityType: "cos_request",
      entityId: request.id,
    });
  } catch (err) {
    logger.error({ err }, "Failed to notify admins of CoS request");
  }
  try {
    await notifyUser(tenantDb, sponsorId, {
      type: NotificationTypes.INFO,
      priority: NotificationPriority.MEDIUM,
      title: "CoS Request Submitted",
      message: `Your request for ${amount} CoS (${visaType}) is pending review.`,
      category: "cos",
      entityType: "cos_request",
      entityId: request.id,
      sendEmail: true,
    });
  } catch (err) {
    logger.error({ err }, "Failed to notify sponsor of CoS request");
  }

  return request;
}

export async function listSponsorCosRequests(tenantDb, sponsorId) {
  return tenantDb.CosRequest.findAll({
    where: { sponsorId },
    order: [["created_at", "DESC"]],
  });
}

export async function updateSponsorCosRequest({ tenantDb, sponsorId, id, visaType, requestedAmount, reason }) {
  const request = await tenantDb.CosRequest.findOne({ where: { id, sponsorId } });
  if (!request) throw httpError("CoS request not found", 404);
  if (!SPONSOR_MUTABLE.includes(request.status)) {
    throw httpError("Only pending or under-review requests can be edited", 400);
  }
  if (visaType !== undefined) request.visaType = visaType;
  if (requestedAmount !== undefined) request.requestedAmount = toInt(requestedAmount, request.requestedAmount);
  if (reason !== undefined) request.reason = reason;
  await request.save();
  return request;
}

export async function deleteSponsorCosRequest({ tenantDb, sponsorId, id }) {
  const request = await tenantDb.CosRequest.findOne({ where: { id, sponsorId } });
  if (!request) throw httpError("CoS request not found", 404);
  if (!SPONSOR_MUTABLE.includes(request.status)) {
    throw httpError("Only pending or under-review requests can be deleted", 400);
  }
  await request.destroy();
  return true;
}

// ─── Reviewer (admin / caseworker) operations ────────────────────────────────

export async function listCosRequests(tenantDb, { status, sponsorId, assignedCaseworkerId } = {}) {
  const where = {};
  if (status) where.status = status;
  if (sponsorId) where.sponsorId = Number(sponsorId);
  if (assignedCaseworkerId) {
    where.assignedCaseworkerIds = { [Op.contains]: [Number(assignedCaseworkerId)] };
  }
  return tenantDb.CosRequest.findAll({
    where,
    include: sponsorInclude(tenantDb),
    order: [["created_at", "DESC"]],
  });
}

export async function getCosRequestById(tenantDb, id) {
  return tenantDb.CosRequest.findByPk(id, { include: sponsorInclude(tenantDb) });
}

export async function assignCosRequest({ tenantDb, id, caseworkerIds, adminNotes, actorId, req = null }) {
  const ids = extractCaseworkerIds(caseworkerIds);
  if (!ids.length) throw httpError("caseworkerIds must be a non-empty array", 400);

  const request = await tenantDb.CosRequest.findByPk(id);
  if (!request) throw httpError("CoS request not found", 404);

  const caseworkers = await tenantDb.User.findAll({
    where: { id: { [Op.in]: ids }, role_id: 2, status: "active" },
    attributes: ["id", "first_name", "last_name", "email"],
  });
  if (!caseworkers.length) throw httpError("No valid active caseworkers found for provided IDs", 404);

  request.assignedCaseworkerIds = caseworkers.map((cw) => cw.id);
  request.status = COS_STATUS.UNDER_REVIEW;
  if (adminNotes) request.reviewNotes = adminNotes;
  await request.save();

  await auditCos({
    tenantDb,
    request,
    actorId,
    action: "assigned",
    details: { assignedCaseworkerIds: request.assignedCaseworkerIds, previousStatus: COS_STATUS.PENDING },
    req,
  });

  // Notify assigned caseworkers and the sponsor.
  try {
    for (const cw of caseworkers) {
      await notifyUser(tenantDb, cw.id, {
        type: NotificationTypes.INFO,
        priority: NotificationPriority.HIGH,
        title: "New CoS Request Assigned",
        message: `You have been assigned CoS request #${request.id} for review.`,
        category: "cos",
        entityType: "cos_request",
        entityId: request.id,
        actionType: "cos_assigned",
      });
    }
    await notifyUser(tenantDb, request.sponsorId, {
      type: NotificationTypes.INFO,
      priority: NotificationPriority.MEDIUM,
      title: "CoS Request Under Review",
      message: `Your CoS request #${request.id} is now under review.`,
      category: "cos",
      entityType: "cos_request",
      entityId: request.id,
    });
  } catch (err) {
    logger.error({ err }, "Failed to send CoS assignment notifications");
  }

  return request;
}

/**
 * Approve or reject a CoS request.
 * @param {'approve'|'reject'} action
 * On approve: the sponsor's running CoS allocation (SponsorProfile.cosAllocation)
 * is incremented by the approved amount.
 */
export async function reviewCosRequest({ tenantDb, id, action, approvedAmount, reviewNotes, reviewerId, req = null }) {
  if (!["approve", "reject"].includes(action)) throw httpError("Invalid review action", 400);

  const request = await tenantDb.CosRequest.findByPk(id);
  if (!request) throw httpError("CoS request not found", 404);
  if (!REVIEWABLE.includes(request.status)) {
    throw httpError(`A '${request.status}' request cannot be reviewed`, 409, "INVALID_TRANSITION");
  }

  const previousStatus = request.status;
  const now = new Date();
  const newStatus = action === "approve" ? COS_STATUS.APPROVED : COS_STATUS.REJECTED;

  request.status = newStatus;
  request.reviewedBy = reviewerId ?? null;
  request.reviewedAt = now;
  if (reviewNotes != null) request.reviewNotes = reviewNotes;
  if (action === "approve") {
    request.approvedAmount =
      approvedAmount != null ? toInt(approvedAmount, request.requestedAmount) : request.requestedAmount;
  }
  await request.save();

  // Allocation update on approval.
  if (action === "approve") {
    try {
      const profile = await tenantDb.SponsorProfile.findOne({ where: { userId: request.sponsorId } });
      if (profile) {
        profile.cosAllocation = toInt(profile.cosAllocation) + toInt(request.approvedAmount);
        await profile.save();
      }
    } catch (err) {
      logger.error({ err }, "Failed to update sponsor CoS allocation");
    }
  }

  await auditCos({
    tenantDb,
    request,
    actorId: reviewerId,
    action: action === "approve" ? "approved" : "rejected",
    details: { previousStatus, newStatus, approvedAmount: request.approvedAmount ?? null, reviewNotes: reviewNotes ?? null },
    req,
  });

  // Notify sponsor.
  try {
    await notifyUser(tenantDb, request.sponsorId, {
      type: action === "approve" ? NotificationTypes.SUCCESS : NotificationTypes.ERROR,
      priority: action === "approve" ? NotificationPriority.MEDIUM : NotificationPriority.HIGH,
      title: action === "approve" ? "CoS Request Approved" : "CoS Request Rejected",
      message:
        action === "approve"
          ? `Your CoS request #${request.id} was approved for ${request.approvedAmount} allocation(s).`
          : `Your CoS request #${request.id} was rejected.${reviewNotes ? ` Reason: ${reviewNotes}` : ""}`,
      category: "cos",
      entityType: "cos_request",
      entityId: request.id,
      actionType: `cos_${action}`,
      sendEmail: true,
    });
  } catch (err) {
    logger.error({ err }, "Failed to notify sponsor of CoS decision");
  }

  return request;
}

// ─── Summary ─────────────────────────────────────────────────────────────────

/**
 * CoS allocation summary for a sponsor. Total allocation is the sum of approved
 * CoS request amounts; usage is the count of active cases.
 */
export async function getCosSummary(tenantDb, sponsorId) {
  const [approved, profile, activeCases] = await Promise.all([
    tenantDb.CosRequest.findAll({ where: { sponsorId, status: COS_STATUS.APPROVED } }),
    tenantDb.SponsorProfile.findOne({ where: { userId: sponsorId } }),
    tenantDb.Case.findAll({
      where: { sponsorId, status: { [Op.notIn]: INACTIVE_CASE } },
      include: [{ model: tenantDb.CandidateApplication, as: "application", attributes: ["visaType"] }],
      attributes: ["id"],
    }),
  ]);

  const totalAllocated = approved.reduce(
    (sum, r) => sum + toInt(r.approvedAmount != null ? r.approvedAmount : r.requestedAmount),
    0
  );
  const used = activeCases.length;

  const byMap = {};
  approved.forEach((r) => {
    const vt = r.visaType || "General";
    if (!byMap[vt]) byMap[vt] = { visaType: vt, allocated: 0, used: 0, allocationDate: r.created_at };
    byMap[vt].allocated += toInt(r.approvedAmount != null ? r.approvedAmount : r.requestedAmount);
  });
  activeCases.forEach((c) => {
    const vt = c.application?.visaType || "General";
    if (!byMap[vt]) byMap[vt] = { visaType: vt, allocated: 0, used: 0, allocationDate: null };
    byMap[vt].used += 1;
  });

  return {
    summary: { total: totalAllocated, used, remaining: Math.max(totalAllocated - used, 0) },
    byVisaType: Object.values(byMap).map((i) => ({
      ...i,
      remaining: Math.max(i.allocated - i.used, 0),
      expiryDate: profile?.licenceExpiryDate || null,
    })),
    licenceRating: profile?.licenceRating,
    riskLevel: profile?.riskLevel,
  };
}
