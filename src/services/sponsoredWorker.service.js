import { Op } from "sequelize";
import logger from "../utils/logger.js";
import { validateTransition, WORKFLOW_TYPES } from "./workflowEngine.service.js";

function ownershipError(message, code) {
  const err = new Error(message);
  err.statusCode = 403;
  err.code = code;
  return err;
}

// ─── Status constants ─────────────────────────────────────────────────────────

export const WORKER_STATUS = Object.freeze({
  // Phase-5 user-facing aliases matching the request.
  VISA_PENDING:           "CoS Assigned",
  VISA_GRANTED:           "Visa Granted",
  VISA_REJECTED:          "Visa Rejected",
  // Full stage chain.
  COS_ASSIGNED:           "CoS Assigned",
  IMMIGRATION_ASSESSMENT: "Immigration Assessment",
  VISA_PREPARATION:       "Visa Preparation",
  COMPLIANCE_REVIEW:      "Compliance Review",
  VISA_DECISION:          "Visa Decision",
});

// ─── Audit action constants ───────────────────────────────────────────────────

export const WORKER_AUDIT_ACTIONS = Object.freeze({
  CREATED:                "created",
  STAGE_ADVANCED:         "stage_advanced",
  CASEWORKER_ASSIGNED:    "caseworker_assigned",
  IMMIGRATION_ASSESSMENT: "immigration_assessment",
  VISA_PREPARATION:       "visa_preparation",
  COMPLIANCE_REVIEW:      "compliance_review",
  VISA_DECISION:          "visa_decision",
  VISA_GRANTED:           "visa_granted",
  VISA_REJECTED:          "visa_rejected",
  DELETED:                "worker_deleted",
  RESTORED:               "worker_restored",
});

// ─── Internal helpers ─────────────────────────────────────────────────────────

function statusToAuditAction(status) {
  switch (status) {
    case "CoS Assigned":           return WORKER_AUDIT_ACTIONS.CREATED;
    case "Immigration Assessment": return WORKER_AUDIT_ACTIONS.IMMIGRATION_ASSESSMENT;
    case "Visa Preparation":       return WORKER_AUDIT_ACTIONS.VISA_PREPARATION;
    case "Compliance Review":      return WORKER_AUDIT_ACTIONS.COMPLIANCE_REVIEW;
    case "Visa Decision":          return WORKER_AUDIT_ACTIONS.VISA_DECISION;
    case "Visa Granted":           return WORKER_AUDIT_ACTIONS.VISA_GRANTED;
    case "Visa Rejected":          return WORKER_AUDIT_ACTIONS.VISA_REJECTED;
    default:                       return WORKER_AUDIT_ACTIONS.STAGE_ADVANCED;
  }
}

async function recordWorkerAudit(tenantDb, { sponsoredWorkerId, action, fromStatus, toStatus, actorId, notes }) {
  try {
    await tenantDb.SponsoredWorkerAudit.create({
      sponsoredWorkerId,
      action,
      fromStatus: fromStatus ?? null,
      toStatus,
      actorId: actorId ?? null,
      notes: notes ?? null,
    });
  } catch (err) {
    logger.error({ err }, "sponsoredWorker: failed to write audit row");
  }
}

/**
 * HIGH-003: Atomic worker state change.
 *
 * Opens a transaction, locks the SponsoredWorker row FOR UPDATE, validates the
 * FSM transition, updates status (plus any extra fields), and writes the audit
 * row — all in a single commit.  Rollback occurs on any failure, including an
 * audit INSERT failure (no longer best-effort inside the transaction).
 *
 * @param {object}   tenantDb
 * @param {number}   workerId
 * @param {string}   nextStatus    - Target FSM status.
 * @param {object}   extraFields   - Any additional fields to set on the worker row.
 * @param {string}   auditAction   - WORKER_AUDIT_ACTIONS constant.
 * @param {string|null} actorId
 * @param {string|null} notes
 * @returns {Promise<object>}      - The updated worker instance.
 */
async function atomicWorkerStateChange(
  tenantDb,
  { workerId, nextStatus, extraFields = {}, auditAction, actorId, notes }
) {
  const t = await tenantDb.sequelize.transaction();
  let worker;
  try {
    // Lock the row — serialises concurrent stage updates on the same worker.
    worker = await tenantDb.SponsoredWorker.findByPk(workerId, {
      lock: true,
      transaction: t,
    });
    if (!worker) {
      const err = new Error("Sponsored worker not found.");
      err.statusCode = 404;
      throw err;
    }

    // Re-validate FSM inside the transaction (status may have changed since caller loaded it).
    const { valid, message } = validateTransition(
      WORKFLOW_TYPES.WORKER,
      worker.status,
      nextStatus
    );
    if (!valid) {
      const err = new Error(message);
      err.statusCode = 422;
      throw err;
    }

    const fromStatus = worker.status;
    worker.status = nextStatus;
    Object.assign(worker, extraFields);
    await worker.save({ transaction: t });

    // Audit write is inside the transaction — not best-effort.
    // An audit INSERT failure causes a full rollback.
    await tenantDb.SponsoredWorkerAudit.create({
      sponsoredWorkerId: worker.id,
      action: auditAction,
      fromStatus,
      toStatus: nextStatus,
      actorId: actorId ?? null,
      notes: notes ?? null,
    }, { transaction: t });

    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }
  return worker;
}

export function extractCaseworkerIds(value) {
  let list = value;
  if (!Array.isArray(list)) {
    if (list == null) return [];
    list = [list];
  }
  return list
    .map((e) => {
      if (typeof e === "object" && e !== null) return Number(e.id ?? e.userId ?? e);
      return Number(e);
    })
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function isCaseworkerAssigned(worker, caseworkerId) {
  const ids = extractCaseworkerIds(worker.assignedCaseworkerIds);
  return ids.includes(Number(caseworkerId));
}

// ─── Base includes used by most read operations ───────────────────────────────

function baseIncludes(tenantDb) {
  const includes = [];
  if (tenantDb.User) {
    includes.push({ model: tenantDb.User, as: "sponsor", attributes: ["id", "first_name", "last_name", "email"] });
  }
  return includes;
}

// ─── Public service functions ─────────────────────────────────────────────────

/**
 * Register a new sponsored worker against a CoS allocation.
 * Status begins at 'CoS Assigned' (VISA_PENDING).
 */
export async function createSponsoredWorker(tenantDb, {
  sponsorId,
  organisationId,
  cosRequestId,
  cosAllocationRecordId,
  workerFirstName,
  workerLastName,
  workerEmail,
  workerNationality,
  visaType,
  notes,
}, actorId) {
  if (!workerFirstName?.trim() || !workerLastName?.trim()) {
    const err = new Error("Worker first name and last name are required.");
    err.statusCode = 400;
    throw err;
  }
  if (!sponsorId) {
    const err = new Error("sponsorId is required.");
    err.statusCode = 400;
    throw err;
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (workerEmail !== undefined && workerEmail !== null && workerEmail !== "") {
    if (!EMAIL_RE.test(String(workerEmail).trim())) {
      const err = new Error("Invalid worker email format.");
      err.statusCode = 400;
      throw err;
    }
  }

  // CRIT-001: Validate cosRequestId ownership — read-only check, no lock needed.
  if (cosRequestId != null) {
    const cosReq = await tenantDb.CosRequest.findByPk(cosRequestId, {
      attributes: ["id", "sponsorId"],
    });
    if (!cosReq) {
      const err = new Error("CoS request not found.");
      err.statusCode = 404;
      throw err;
    }
    if (Number(cosReq.sponsorId) !== Number(sponsorId)) {
      throw ownershipError(
        "CoS request does not belong to this sponsor.",
        "REQUEST_OWNERSHIP_VIOLATION"
      );
    }
  }

  // ── Allocation path: atomic lock → count → create → audit ───────────────────
  // P2-WM-12 fix: the entire allocation check, worker creation, and audit write
  // happen inside a single transaction with SELECT FOR UPDATE on CosAllocationRecord.
  //
  // The FOR UPDATE lock serialises concurrent creation requests for the same
  // allocation — request B blocks at findByPk until request A commits or rolls
  // back. When B finally reads the row, it re-counts the workers and sees the
  // committed state from A. This makes over-allocation mathematically impossible:
  // the count is always read after the previous writer has fully committed.
  if (cosAllocationRecordId != null) {
    return tenantDb.sequelize.transaction(async (t) => {
      // Acquire exclusive row lock — serialises all concurrent creators.
      const allocation = await tenantDb.CosAllocationRecord.findByPk(cosAllocationRecordId, {
        attributes: ["id", "allocatedAmount", "sponsorId"],
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      if (!allocation) {
        const err = new Error("CoS allocation record not found.");
        err.statusCode = 404;
        throw err;
      }
      if (Number(allocation.sponsorId) !== Number(sponsorId)) {
        throw ownershipError(
          "CoS allocation record does not belong to this sponsor.",
          "ALLOCATION_OWNERSHIP_VIOLATION"
        );
      }

      // Count is inside the transaction — sees the committed writes from any
      // preceding concurrent request that held this lock before us.
      const usedCount = await tenantDb.SponsoredWorker.count({
        where: { cosAllocationRecordId },
        transaction: t,
      });
      if (usedCount >= allocation.allocatedAmount) {
        const err = new Error(
          `CoS allocation exhausted. Allocated: ${allocation.allocatedAmount}, already assigned: ${usedCount}.`
        );
        err.statusCode = 409;
        err.code = "ALLOCATION_EXCEEDED";
        throw err;
      }

      // Create and audit in the same transaction — both roll back on failure.
      const worker = await tenantDb.SponsoredWorker.create({
        sponsorId,
        organisationId: organisationId ?? null,
        cosRequestId: cosRequestId ?? null,
        cosAllocationRecordId,
        workerFirstName: workerFirstName.trim(),
        workerLastName: workerLastName.trim(),
        workerEmail: workerEmail?.trim() ?? null,
        workerNationality: workerNationality?.trim() ?? null,
        visaType: visaType?.trim() ?? null,
        status: WORKER_STATUS.COS_ASSIGNED,
        notes: notes?.trim() ?? null,
      }, { transaction: t });

      await tenantDb.SponsoredWorkerAudit.create({
        sponsoredWorkerId: worker.id,
        action: WORKER_AUDIT_ACTIONS.CREATED,
        fromStatus: null,
        toStatus: WORKER_STATUS.COS_ASSIGNED,
        actorId: actorId ?? null,
        notes: notes ?? null,
      }, { transaction: t });

      return worker;
      // Notifications (none currently in this function) must be added post-commit,
      // i.e. after this transaction() block resolves, never inside it.
    });
  }

  // ── No-allocation path: simpler, no locking required ───────────────────────
  const worker = await tenantDb.SponsoredWorker.create({
    sponsorId,
    organisationId: organisationId ?? null,
    cosRequestId: cosRequestId ?? null,
    cosAllocationRecordId: null,
    workerFirstName: workerFirstName.trim(),
    workerLastName: workerLastName.trim(),
    workerEmail: workerEmail?.trim() ?? null,
    workerNationality: workerNationality?.trim() ?? null,
    visaType: visaType?.trim() ?? null,
    status: WORKER_STATUS.COS_ASSIGNED,
    notes: notes?.trim() ?? null,
  });

  await recordWorkerAudit(tenantDb, {
    sponsoredWorkerId: worker.id,
    action: WORKER_AUDIT_ACTIONS.CREATED,
    fromStatus: null,
    toStatus: WORKER_STATUS.COS_ASSIGNED,
    actorId,
    notes,
  });

  return worker;
}

/**
 * Advance a worker's status to the next stage in the workflow.
 * HIGH-003: status update and audit write are atomic (single transaction).
 */
export async function advanceWorkerStage(tenantDb, { workerId, nextStatus, notes }, actorId) {
  return atomicWorkerStateChange(tenantDb, {
    workerId,
    nextStatus,
    extraFields: notes != null ? { notes } : {},
    auditAction: statusToAuditAction(nextStatus),
    actorId,
    notes,
  });
}

/**
 * Grant a visa — transitions to 'Visa Granted'.
 * Only reachable from 'Visa Decision'.
 */
export async function grantWorkerVisa(tenantDb, { workerId, notes }, actorId) {
  return advanceWorkerStage(tenantDb, { workerId, nextStatus: WORKER_STATUS.VISA_GRANTED, notes }, actorId);
}

/**
 * Reject a visa — transitions to 'Visa Rejected'.
 * HIGH-003: status update and audit write are atomic (single transaction).
 */
export async function rejectWorkerVisa(tenantDb, { workerId, rejectionReason, notes }, actorId) {
  if (!rejectionReason?.trim()) {
    const err = new Error("rejectionReason is required when rejecting a visa.");
    err.statusCode = 400;
    throw err;
  }

  return atomicWorkerStateChange(tenantDb, {
    workerId,
    nextStatus: WORKER_STATUS.VISA_REJECTED,
    extraFields: {
      rejectionReason: rejectionReason.trim(),
      ...(notes != null ? { notes } : {}),
    },
    auditAction: WORKER_AUDIT_ACTIONS.VISA_REJECTED,
    actorId,
    notes: notes ?? rejectionReason,
  });
}

/**
 * Assign caseworkers to a sponsored worker record.
 */
export async function assignWorkerCaseworkers(tenantDb, { workerId, caseworkerIds }, actorId) {
  const worker = await tenantDb.SponsoredWorker.findByPk(workerId);
  if (!worker) {
    const err = new Error("Sponsored worker not found.");
    err.statusCode = 404;
    throw err;
  }

  const ids = extractCaseworkerIds(caseworkerIds);
  worker.assignedCaseworkerIds = ids;
  await worker.save();

  await recordWorkerAudit(tenantDb, {
    sponsoredWorkerId: worker.id,
    action: WORKER_AUDIT_ACTIONS.CASEWORKER_ASSIGNED,
    fromStatus: worker.status,
    toStatus: worker.status,
    actorId,
    notes: `Assigned caseworker IDs: ${ids.join(", ")}`,
  });

  return worker;
}

/** Get a single worker by primary key, with sponsor user included. */
export async function getSponsoredWorkerById(tenantDb, workerId) {
  return tenantDb.SponsoredWorker.findByPk(workerId, {
    include: baseIncludes(tenantDb),
  });
}

/** List all workers for a sponsor, newest first. */
export async function listSponsorWorkers(tenantDb, sponsorId) {
  return tenantDb.SponsoredWorker.findAll({
    where: { sponsorId },
    include: baseIncludes(tenantDb),
    order: [["created_at", "DESC"]],
  });
}

/**
 * List workers assigned to a caseworker.
 * Uses Sequelize Op.contains which compiles to the standard PostgreSQL @> operator,
 * avoiding the non-existent jsonb_contains() function and using parameterized queries.
 */
export async function listCaseworkerWorkers(tenantDb, caseworkerId) {
  return tenantDb.SponsoredWorker.findAll({
    where: {
      assignedCaseworkerIds: { [Op.contains]: [Number(caseworkerId)] },
    },
    include: baseIncludes(tenantDb),
    order: [["created_at", "DESC"]],
  });
}

/** List all workers for admin, with optional status filter.
 *  Pass includeDeleted=true to surface soft-deleted records alongside live ones. */
export async function listAllWorkers(tenantDb, { status, sponsorId, includeDeleted = false } = {}) {
  const where = {};
  if (status) where.status = status;
  if (sponsorId) where.sponsorId = sponsorId;

  return tenantDb.SponsoredWorker.findAll({
    where,
    ...(includeDeleted ? { paranoid: false } : {}),
    include: baseIncludes(tenantDb),
    order: [["created_at", "DESC"]],
  });
}

/** Get the full immutable audit trail for one worker. */
export async function getWorkerAuditTrail(tenantDb, workerId) {
  return tenantDb.SponsoredWorkerAudit.findAll({
    where: { sponsoredWorkerId: workerId },
    include: tenantDb.User
      ? [{ model: tenantDb.User, as: "actor", attributes: ["id", "first_name", "last_name"] }]
      : [],
    order: [["created_at", "ASC"]],
  });
}

/**
 * Soft-delete a sponsored worker (paranoid destroy).
 * The row is NOT physically removed — deleted_at is set so all standard queries
 * exclude it automatically. The audit event is written in the same transaction.
 */
export async function softDeleteWorker(tenantDb, workerId, actorId) {
  const t = await tenantDb.sequelize.transaction();
  try {
    const worker = await tenantDb.SponsoredWorker.findByPk(workerId, {
      lock: true,
      transaction: t,
    });
    if (!worker) {
      const err = new Error("Sponsored worker not found.");
      err.statusCode = 404;
      throw err;
    }

    const prevStatus = worker.status;
    await worker.destroy({ transaction: t });

    await tenantDb.SponsoredWorkerAudit.create({
      sponsoredWorkerId: worker.id,
      action: WORKER_AUDIT_ACTIONS.DELETED,
      fromStatus: prevStatus,
      toStatus: null,
      actorId: actorId ?? null,
      notes: null,
    }, { transaction: t });

    await t.commit();
    return worker;
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

/**
 * Restore a soft-deleted sponsored worker.
 * Clears deleted_at and writes a worker_restored audit event in the same transaction.
 * Throws 404 if the record doesn't exist, 409 if it was never deleted.
 */
export async function restoreWorker(tenantDb, workerId, actorId) {
  const t = await tenantDb.sequelize.transaction();
  try {
    const worker = await tenantDb.SponsoredWorker.findByPk(workerId, {
      paranoid: false,
      lock: true,
      transaction: t,
    });
    if (!worker) {
      const err = new Error("Sponsored worker not found.");
      err.statusCode = 404;
      throw err;
    }
    if (!worker.deletedAt) {
      const err = new Error("Worker is not deleted.");
      err.statusCode = 409;
      throw err;
    }

    await worker.restore({ transaction: t });

    await tenantDb.SponsoredWorkerAudit.create({
      sponsoredWorkerId: worker.id,
      action: WORKER_AUDIT_ACTIONS.RESTORED,
      fromStatus: null,
      toStatus: worker.status,
      actorId: actorId ?? null,
      notes: null,
    }, { transaction: t });

    await t.commit();
    return worker;
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

/**
  * Reusable helper to verify if a caseworker is authorized to create/mutate workers
  * for a given sponsor, cosRequest, or cosAllocationRecord.
  */
export async function verifyCaseworkerWorkerOwnership(tenantDb, { sponsorId, cosRequestId, cosAllocationRecordId }, caseworkerId) {
  if (cosRequestId != null) {
    const cosReq = await tenantDb.CosRequest.findByPk(cosRequestId);
    if (cosReq) {
      const ids = extractCaseworkerIds(cosReq.assignedCaseworkerIds);
      if (ids.includes(Number(caseworkerId))) return true;
    }
  }
  if (cosAllocationRecordId != null) {
    const allocation = await tenantDb.CosAllocationRecord.findByPk(cosAllocationRecordId);
    if (allocation?.cosRequestId) {
      const cosReq = await tenantDb.CosRequest.findByPk(allocation.cosRequestId);
      if (cosReq) {
        const ids = extractCaseworkerIds(cosReq.assignedCaseworkerIds);
        if (ids.includes(Number(caseworkerId))) return true;
      }
    }
  }
  if (sponsorId != null) {
    const apps = await tenantDb.LicenceApplication.findAll({ where: { userId: sponsorId } });
    for (const app of apps) {
      const ids = extractCaseworkerIds(app.assignedcaseworkerId);
      if (ids.includes(Number(caseworkerId))) return true;
    }
  }
  return false;
}

