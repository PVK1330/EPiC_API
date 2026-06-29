import { Op, UniqueConstraintError } from "sequelize";
import logger from "../utils/logger.js";
import { recordAuditLog } from "./audit.service.js";
import {
  notifyUser,
  notifyAdmins,
  NotificationTypes,
  NotificationPriority,
} from "./notification.service.js";
import { validateTransition, WORKFLOW_TYPES } from "./workflowEngine.service.js";

/**
 * CoS Request workflow — single source of truth.
 *
 *   Sponsor requests CoS  ->  Pending (COS_PENDING)
 *                              -> (admin assigns caseworker) Under Review
 *                              -> Approved (decision) -> Allocated (COS_APPROVED) + CosAllocationRecord created
 *                              -> Rejected (COS_REJECTED)
 */
export const COS_STATUS = Object.freeze({
  // User-facing aliases (COS_* prefix) map to the string values stored in the DB.
  COS_PENDING:  "Pending",
  COS_APPROVED: "Allocated",
  COS_REJECTED: "Rejected",
  // Full internal status chain
  PENDING:      "Pending",
  UNDER_REVIEW: "Under Review",
  APPROVED:     "Approved",
  REJECTED:     "Rejected",
  ALLOCATED:    "Allocated",
});

/** Derive a unique allocation number from the CoS request id and year. */
function buildAllocationNumber(requestId, allocatedAt) {
  const year = new Date(allocatedAt).getFullYear();
  return `EPIC-COS-${year}-${String(requestId).padStart(6, "0")}`;
}

/** Statuses a sponsor may still edit/withdraw. */
const SPONSOR_MUTABLE = [COS_STATUS.PENDING, COS_STATUS.UNDER_REVIEW];
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
  await recordAuditLog({
    tenantDb,
    userId: actorId ?? null,
    action: `COS_REQUEST_${String(action).toUpperCase()}`,
    resource: "cos_request",
    status: "Success",
    details: JSON.stringify({ cosRequestId: request.id, sponsorId: request.sponsorId, ...details }),
    req,
    organisationId: request.organisationId ?? null,
  }).catch((err) => logger.error({ err, cosRequestId: request.id }, "Failed to record CoS audit log"));
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

/**
 * List a sponsor's own CoS requests.
 *
 * Backwards compatible: by default returns a plain array (findAll).
 * When `pagination` ({ limit, offset }) is supplied, it switches to
 * findAndCountAll and returns { rows, count } so callers can build
 * pagination meta. The where/order are identical in both modes.
 *
 * @param {object} tenantDb
 * @param {number} sponsorId
 * @param {object} [opts]
 * @param {{ limit: number, offset: number }} [opts.pagination]
 * @returns {Promise<Array|{rows: Array, count: number}>}
 */
export async function listSponsorCosRequests(tenantDb, sponsorId, { pagination } = {}) {
  const queryOptions = {
    where: { sponsorId },
    order: [["created_at", "DESC"]],
  };

  if (pagination) {
    const { rows, count } = await tenantDb.CosRequest.findAndCountAll({
      ...queryOptions,
      limit: pagination.limit,
      offset: pagination.offset,
    });
    return { rows, count };
  }

  return tenantDb.CosRequest.findAll(queryOptions);
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

/**
 * List CoS requests for reviewers (admin / caseworker).
 *
 * Backwards compatible: by default returns a plain array (findAll).
 * When `pagination` ({ limit, offset }) is supplied, it switches to
 * findAndCountAll and returns { rows, count } so callers can build
 * pagination meta. All filters/sorts are preserved in both modes.
 *
 * @param {object} tenantDb
 * @param {object} [opts]
 * @param {string} [opts.status]
 * @param {number} [opts.sponsorId]
 * @param {number} [opts.assignedCaseworkerId]
 * @param {{ limit: number, offset: number }} [opts.pagination]
 * @returns {Promise<Array|{rows: Array, count: number}>}
 */
export async function listCosRequests(
  tenantDb,
  { status, sponsorId, assignedCaseworkerId, pagination } = {}
) {
  const where = {};
  if (status) where.status = status;
  if (sponsorId) where.sponsorId = Number(sponsorId);
  if (assignedCaseworkerId) {
    where.assignedCaseworkerIds = { [Op.contains]: [Number(assignedCaseworkerId)] };
  }

  const queryOptions = {
    where,
    include: sponsorInclude(tenantDb),
    order: [["created_at", "DESC"]],
  };

  if (pagination) {
    // findAndCountAll → { count, rows }. With the to-one sponsor/reviewer
    // includes here, count stays the number of CosRequest rows (no fan-out).
    const { rows, count } = await tenantDb.CosRequest.findAndCountAll({
      ...queryOptions,
      limit: pagination.limit,
      offset: pagination.offset,
    });
    return { rows, count };
  }

  return tenantDb.CosRequest.findAll(queryOptions);
}

export async function getCosRequestById(tenantDb, id) {
  return tenantDb.CosRequest.findByPk(id, { include: sponsorInclude(tenantDb) });
}

export async function assignCosRequest({ tenantDb, id, caseworkerIds, adminNotes, actorId, req = null }) {
  const ids = extractCaseworkerIds(caseworkerIds);
  if (!ids.length) throw httpError("caseworkerIds must be a non-empty array", 400);

  const t = await tenantDb.sequelize.transaction();
  try {
    const request = await tenantDb.CosRequest.findByPk(id, {
      lock: true,
      transaction: t,
    });
    if (!request) throw httpError("CoS request not found", 404);

    const caseworkers = await tenantDb.User.findAll({
      where: { id: { [Op.in]: ids }, role_id: 2, status: "active" },
      attributes: ["id", "first_name", "last_name", "email"],
      transaction: t,
    });
    if (!caseworkers.length) throw httpError("No valid active caseworkers found for provided IDs", 404);

    // Route through FSM — Pending is the only valid starting state for assignment.
    const assignCheck = validateTransition(WORKFLOW_TYPES.COS, request.status, COS_STATUS.UNDER_REVIEW);
    if (!assignCheck.valid) {
      throw httpError(assignCheck.message, 409, "INVALID_TRANSITION");
    }

    request.assignedCaseworkerIds = caseworkers.map((cw) => cw.id);
    request.status = COS_STATUS.UNDER_REVIEW;
    if (adminNotes) request.reviewNotes = adminNotes;
    await request.save({ transaction: t });

    await t.commit();

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
  } catch (err) {
    try {
      await t.rollback();
    } catch (rErr) {}
    throw err;
  }
}

/**
 * Approve or reject a CoS request.
 * @param {'approve'|'reject'} action
 *
 * On approve: the sponsor's running CoS allocation (SponsorProfile.cosAllocation)
 * is incremented by the approved amount and an immutable CosAllocationRecord is
 * created — all inside one outer transaction (ISSUE-004).
 *
 * Concurrency safety (ISSUE-004):
 *   - CosRequest row is locked SELECT FOR UPDATE before any reads or writes.
 *   - FSM validation happens AFTER the lock so a concurrent reviewer cannot
 *     race past the status check.
 *   - CosAllocationRecord has a UNIQUE constraint on cosRequestId; a duplicate
 *     attempt by a second concurrent call throws UniqueConstraintError → 409.
 */
export async function reviewCosRequest({ tenantDb, id, action, approvedAmount, reviewNotes, reviewerId, req = null }) {
  if (!["approve", "reject"].includes(action)) throw httpError("Invalid review action", 400);

  const now = new Date();
  const newStatus = action === "approve" ? COS_STATUS.APPROVED : COS_STATUS.REJECTED;

  // ── Outer transaction (ISSUE-004) ────────────────────────────────────────
  const t = await tenantDb.sequelize.transaction();
  let request, previousStatus;
  let txCommitted = false;

  try {
    // Lock the CosRequest row FOR UPDATE — concurrent callers queue here.
    request = await tenantDb.CosRequest.findByPk(id, {
      lock: true,
      transaction: t,
    });
    if (!request) {
      await t.rollback();
      txCommitted = true; // rolled back — don't rollback again in catch
      throw httpError("CoS request not found", 404);
    }

    previousStatus = request.status;

    // Re-validate AFTER lock — reads fresh, locked status (ISSUE-004).
    const reviewCheck = validateTransition(WORKFLOW_TYPES.COS, request.status, newStatus);
    if (!reviewCheck.valid) {
      await t.rollback();
      txCommitted = true;
      throw httpError(reviewCheck.message, 409, "INVALID_TRANSITION");
    }

    request.status = newStatus;
    request.reviewedBy = reviewerId ?? null;
    request.reviewedAt = now;
    if (reviewNotes != null) request.reviewNotes = reviewNotes;

    if (action === "approve") {
      const finalAmount = approvedAmount != null ? toInt(approvedAmount, request.requestedAmount) : request.requestedAmount;
      // BUG-01 fix: validate before any DB writes so the throw goes into catch
      // while the transaction is still open and gets rolled back.
      if (finalAmount > request.requestedAmount) {
        throw httpError("Approved amount cannot exceed requested amount", 400);
      }
      request.approvedAmount = finalAmount;

      await request.save({ transaction: t });

      // Lock SponsorProfile to prevent concurrent CoS requests double-crediting.
      // BUG-02 fix: throw when no SponsorProfile exists — do not silently skip
      // the quota debit while still creating an allocation record.
      const profile = await tenantDb.SponsorProfile.findOne({
        where: { userId: request.sponsorId },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!profile) {
        throw httpError(
          "Sponsor profile not found — cannot approve CoS request without an active sponsor profile.",
          422
        );
      }

      profile.cosAllocation = toInt(profile.cosAllocation) + toInt(request.approvedAmount);
      await profile.save({ transaction: t });
      request.status = COS_STATUS.ALLOCATED;
      await request.save({ transaction: t });

      // CosAllocationRecord has UNIQUE(cosRequestId) — a second concurrent
      // approval attempt throws UniqueConstraintError, caught below → 409.
      const allocatedAt = now;
      await tenantDb.CosAllocationRecord.create(
        {
          cosRequestId: request.id,
          sponsorId: request.sponsorId,
          organisationId: request.organisationId ?? null,
          allocationNumber: buildAllocationNumber(request.id, allocatedAt),
          visaType: request.visaType ?? null,
          allocatedAmount: toInt(request.approvedAmount),
          allocatedById: reviewerId ?? null,
          allocatedAt,
          expiryDate: profile.licenceExpiryDate ?? null,
          notes: reviewNotes ?? null,
          status: "Active",
        },
        { transaction: t }
      );
    } else {
      await request.save({ transaction: t });
    }

    await t.commit();
    txCommitted = true;
  } catch (err) {
    // BUG-01 fix: always roll back if the transaction has not already been
    // committed or explicitly rolled back above.
    if (!txCommitted) {
      try {
        await t.rollback();
      } catch (rErr) {
        logger.error({ err: rErr }, "reviewCosRequest: rollback failed");
      }
    }

    if (err instanceof UniqueConstraintError) {
      const conflict = httpError(
        "This CoS request has already been allocated. Duplicate approval attempts are not permitted.",
        409,
        "DUPLICATE_ALLOCATION"
      );
      throw conflict;
    }

    if (!err.statusCode || err.statusCode >= 500) {
      logger.error({ err, cosRequestId: id }, "reviewCosRequest: transaction failed");
    }
    throw err;
  }

  // ── Post-commit side-effects (best-effort) ────────────────────────────────
  const finalStatus = request.status;

  await auditCos({
    tenantDb,
    request,
    actorId: reviewerId,
    action: finalStatus === COS_STATUS.ALLOCATED ? "allocated" : "rejected",
    details: {
      previousStatus,
      newStatus: finalStatus,
      approvedAmount: request.approvedAmount ?? null,
      reviewNotes: reviewNotes ?? null,
    },
    req,
  });

  try {
    const isAllocated = finalStatus === COS_STATUS.ALLOCATED;
    await notifyUser(tenantDb, request.sponsorId, {
      type: isAllocated ? NotificationTypes.SUCCESS : NotificationTypes.ERROR,
      priority: isAllocated ? NotificationPriority.MEDIUM : NotificationPriority.HIGH,
      title: isAllocated ? "CoS Request Allocated" : "CoS Request Rejected",
      message: isAllocated
        ? `Your CoS request #${request.id} has been approved and ${request.approvedAmount} CoS allocation(s) have been added to your account.`
        : `Your CoS request #${request.id} was rejected.${reviewNotes ? ` Reason: ${reviewNotes}` : ""}`,
      category: "cos",
      entityType: "cos_request",
      entityId: request.id,
      actionType: isAllocated ? "cos_allocated" : "cos_rejected",
      sendEmail: true,
    });
  } catch (err) {
    logger.error({ err }, "Failed to notify sponsor of CoS decision");
  }

  return request;
}

/**
 * Request additional information from the sponsor without changing status.
 * Promotes Pending → Under Review so it can be tracked by caseworkers.
 */
export async function requestInfoCosRequest({ tenantDb, id, reviewNotes, reviewerId, req = null }) {
  const request = await tenantDb.CosRequest.findByPk(id);
  if (!request) throw httpError("CoS request not found", 404);
  if (!reviewNotes?.trim()) throw httpError("Notes are required when requesting information", 400);

  // Route through FSM (ISSUE-005).
  // Pending → Under Review: validate and advance.
  // Under Review → Under Review: no status change needed (already in review).
  if (request.status === COS_STATUS.PENDING) {
    const infoCheck = validateTransition(WORKFLOW_TYPES.COS, COS_STATUS.PENDING, COS_STATUS.UNDER_REVIEW);
    if (!infoCheck.valid) throw httpError(infoCheck.message, 409, "INVALID_TRANSITION");
    request.status = COS_STATUS.UNDER_REVIEW;
  } else if (request.status !== COS_STATUS.UNDER_REVIEW) {
    const { message } = validateTransition(WORKFLOW_TYPES.COS, request.status, COS_STATUS.UNDER_REVIEW);
    throw httpError(message || `Cannot request information on a '${request.status}' request`, 409, "INVALID_TRANSITION");
  }
  request.reviewNotes = reviewNotes.trim();
  await request.save();

  await auditCos({
    tenantDb,
    request,
    actorId: reviewerId,
    action: "info_requested",
    details: { reviewNotes: reviewNotes.trim() },
    req,
  });

  try {
    await notifyUser(tenantDb, request.sponsorId, {
      type: NotificationTypes.WARNING,
      priority: NotificationPriority.HIGH,
      title: "Additional Information Required",
      message: `Your CoS request #${request.id} requires additional information: ${reviewNotes.trim()}`,
      category: "cos",
      entityType: "cos_request",
      entityId: request.id,
      actionType: "cos_info_requested",
      sendEmail: true,
    });
  } catch (err) {
    logger.error({ err }, "Failed to notify sponsor of CoS information request");
  }

  return request;
}

// ─── Allocation Record ────────────────────────────────────────────────────────

/**
 * Retrieve the formal allocation record for an approved CoS request.
 * Returns null when the request has not been approved/allocated yet.
 */
export async function getCosAllocationRecord(tenantDb, cosRequestId) {
  return tenantDb.CosAllocationRecord.findOne({
    where: { cosRequestId },
    include: [
      {
        model: tenantDb.User,
        as: "allocatedBy",
        attributes: ["id", "first_name", "last_name", "email"],
      },
    ],
  });
}

/**
 * List all allocation records for a sponsor (Phase 4 summary; not worker-level).
 */
export async function listSponsorAllocationRecords(tenantDb, sponsorId) {
  // Fetch real allocation records + profile CoS total in parallel.
  const [records, profile] = await Promise.all([
    tenantDb.CosAllocationRecord.findAll({
      where: { sponsorId },
      include: [
        { model: tenantDb.User, as: "allocatedBy", attributes: ["id", "first_name", "last_name", "email"] },
        { model: tenantDb.CosRequest, as: "cosRequest", attributes: ["id", "visaType", "requestedAmount", "reason", "created_at"] },
      ],
      order: [["allocated_at", "DESC"]],
    }),
    tenantDb.SponsorProfile.findOne({ where: { userId: sponsorId } }).catch(() => null),
  ]);

  // Attach usedSlots + remainingSlots per allocation record.
  const counts = await Promise.all(
    records.map((r) =>
      tenantDb.SponsoredWorker.count({ where: { cosAllocationRecordId: r.id } }).catch(() => 0)
    )
  );

  const enriched = records.map((r, i) => {
    const plain = typeof r.toJSON === "function" ? r.toJSON() : { ...r };
    plain.usedSlots = counts[i] ?? 0;
    plain.remainingSlots = Math.max((plain.allocatedAmount || 0) - plain.usedSlots, 0);
    return plain;
  });

  // ── Virtual "Licence Grant" entry ─────────────────────────────────────────
  // The initial CoS pool granted with the licence is stored only on
  // SponsorProfile.cosAllocation. It has no CosAllocationRecord row. Compute
  // how many of those slots are not yet covered by explicit request records and
  // surface the remainder as a virtual entry so the dropdown is always populated.
  const profileCos = toInt(profile?.cosAllocation);
  const requestTotal = enriched.reduce((s, r) => s + (r.allocatedAmount || 0), 0);
  const licenceGrantPool = profileCos - requestTotal;

  if (licenceGrantPool > 0) {
    // Workers assigned CoS without any cosAllocationRecordId = drawing from the
    // general licence-grant pool.
    const generalUsed = await tenantDb.SponsoredWorker.count({
      where: {
        sponsorId,
        cosAllocationRecordId: null,
        workerCosNumber: { [Op.ne]: null },
        status: { [Op.notIn]: ["Visa Rejected", "deleted"] },
      },
    }).catch(() => 0);

    const generalRemaining = Math.max(licenceGrantPool - generalUsed, 0);

    // Prepend the virtual entry — id: null signals "general pool" to the frontend.
    enriched.unshift({
      id: null,
      isLicenceGrant: true,
      allocationNumber: `LICENCE-GRANT-${profile?.sponsorLicenceNumber || sponsorId}`,
      visaType: null,
      allocatedAmount: licenceGrantPool,
      usedSlots: generalUsed,
      remainingSlots: generalRemaining,
      status: "Active",
      cosRequest: null,
      notes: "CoS slots granted with your Sponsor Licence",
    });
  }

  return enriched;
}

// ─── Summary ─────────────────────────────────────────────────────────────────

/**
 * CoS allocation summary for a sponsor.
 *
 * Total allocation comes from SponsorProfile.cosAllocation — the single source
 * of truth. It is set at licence-grant time (initial allocation) and incremented
 * on every subsequent approved CoS request, so it always reflects the running
 * total. Summing CosRequest rows alone would miss the initial grant allocation.
 *
 * The per-visa-type breakdown is derived from approved CosRequest rows (which
 * carry a visaType), supplemented by a "General" bucket for any allocation that
 * pre-dates the CoS-request workflow (i.e. profile.cosAllocation - sum of
 * approved requests).
 */
export async function getCosSummary(tenantDb, sponsorId) {
  const [approved, profile, activeCases, activeWorkers] = await Promise.all([
    tenantDb.CosRequest.findAll({ where: { sponsorId, status: { [Op.in]: [COS_STATUS.APPROVED, COS_STATUS.ALLOCATED] } } }),
    tenantDb.SponsorProfile.findOne({ where: { userId: sponsorId } }),
    tenantDb.Case.findAll({
      where: { sponsorId, status: { [Op.notIn]: INACTIVE_CASE } },
      include: [{ model: tenantDb.CandidateApplication, as: "application", attributes: ["visaType"] }],
      attributes: ["id"],
    }),
    // Phase 5 sponsored_workers — count workers who have a CoS assigned
    // (workerCosNumber is set at CoS assignment time).
    tenantDb.SponsoredWorker
      ? tenantDb.SponsoredWorker.findAll({
          where: {
            sponsorId,
            workerCosNumber: { [Op.ne]: null },
            status: { [Op.notIn]: ["Visa Rejected", "deleted"] },
          },
          attributes: ["id", "visaType"],
        })
      : Promise.resolve([]),
  ]);

  // profile.cosAllocation is the authoritative total — includes initial grant +
  // all subsequently approved CoS requests.
  const totalAllocated = toInt(profile?.cosAllocation);

  // Sum of CosRequest approvals (used for the per-visa breakdown only).
  const requestsTotal = approved.reduce(
    (sum, r) => sum + toInt(r.approvedAmount != null ? r.approvedAmount : r.requestedAmount),
    0
  );

  // Combined used count: legacy Cases + new SponsoredWorker rows with CoS assigned.
  const used = activeCases.length + (activeWorkers?.length || 0);

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
  (activeWorkers || []).forEach((w) => {
    const vt = w.visaType || "General";
    if (!byMap[vt]) byMap[vt] = { visaType: vt, allocated: 0, used: 0, allocationDate: null };
    byMap[vt].used += 1;
  });

  // If there is an initial licence-grant allocation not covered by CosRequest
  // rows (e.g. the licence was granted before the CoS-request workflow), surface
  // it as a "General" bucket so the breakdown total matches the summary total.
  const grantOnlyAllocation = totalAllocated - requestsTotal;
  if (grantOnlyAllocation > 0) {
    if (!byMap["General"]) byMap["General"] = { visaType: "General", allocated: 0, used: 0, allocationDate: null };
    byMap["General"].allocated += grantOnlyAllocation;
  }

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
