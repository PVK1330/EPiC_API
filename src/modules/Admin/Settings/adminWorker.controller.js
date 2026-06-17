import logger from "../../../utils/logger.js";
import {
  createSponsoredWorker,
  advanceWorkerStage,
  grantWorkerVisa,
  rejectWorkerVisa,
  assignWorkerCaseworkers,
  getSponsoredWorkerById,
  listAllWorkers,
  getWorkerAuditTrail,
  softDeleteWorker,
  restoreWorker,
} from "../../../services/sponsoredWorker.service.js";

const handle = (res, err, fallback) => {
  const code = err?.statusCode || 500;
  if (code >= 500) logger.error({ err }, fallback);
  return res.status(code).json({ status: "error", message: err.message || fallback });
};

/** GET /workers — list all workers, optionally filtered by status, sponsorId, or includeDeleted. */
export const getAllWorkers = async (req, res) => {
  try {
    const { status, sponsorId, includeDeleted } = req.query;
    const workers = await listAllWorkers(req.tenantDb, {
      status: status || undefined,
      sponsorId: sponsorId ? Number(sponsorId) : undefined,
      includeDeleted: includeDeleted === "true",
    });
    res.status(200).json({ status: "success", data: workers });
  } catch (err) {
    handle(res, err, "Failed to fetch workers");
  }
};

/** GET /workers/:id — get a single worker. */
export const getWorkerAdmin = async (req, res) => {
  try {
    const worker = await getSponsoredWorkerById(req.tenantDb, req.params.id);
    if (!worker) return res.status(404).json({ status: "error", message: "Worker not found" });
    res.status(200).json({ status: "success", data: worker });
  } catch (err) {
    handle(res, err, "Failed to fetch worker");
  }
};

/** POST /workers — admin registers a new sponsored worker. */
export const createWorkerAdmin = async (req, res) => {
  try {
    const {
      sponsorId, organisationId, cosRequestId, cosAllocationRecordId,
      workerFirstName, workerLastName, workerEmail, workerNationality, visaType, notes,
    } = req.body;
    const worker = await createSponsoredWorker(
      req.tenantDb,
      { sponsorId, organisationId, cosRequestId, cosAllocationRecordId, workerFirstName, workerLastName, workerEmail, workerNationality, visaType, notes },
      req.user.userId
    );
    res.status(201).json({ status: "success", message: "Worker created", data: worker });
  } catch (err) {
    handle(res, err, "Failed to create worker");
  }
};

/** POST /workers/:id/advance — admin advances worker to next stage. */
export const advanceWorkerAdmin = async (req, res) => {
  try {
    const { nextStatus, notes } = req.body;
    const updated = await advanceWorkerStage(
      req.tenantDb,
      { workerId: req.params.id, nextStatus, notes },
      req.user.userId
    );
    res.status(200).json({ status: "success", message: `Worker advanced to '${updated.status}'`, data: updated });
  } catch (err) {
    handle(res, err, "Failed to advance worker stage");
  }
};

/** POST /workers/:id/grant-visa — admin records Visa Granted. */
export const grantVisaAdmin = async (req, res) => {
  try {
    const updated = await grantWorkerVisa(
      req.tenantDb,
      { workerId: req.params.id, notes: req.body.notes },
      req.user.userId
    );
    res.status(200).json({ status: "success", message: "Visa granted", data: updated });
  } catch (err) {
    handle(res, err, "Failed to grant visa");
  }
};

/** POST /workers/:id/reject-visa — admin records Visa Rejected. */
export const rejectVisaAdmin = async (req, res) => {
  try {
    const { rejectionReason, notes } = req.body;
    const updated = await rejectWorkerVisa(
      req.tenantDb,
      { workerId: req.params.id, rejectionReason, notes },
      req.user.userId
    );
    res.status(200).json({ status: "success", message: "Visa rejected", data: updated });
  } catch (err) {
    handle(res, err, "Failed to reject visa");
  }
};

/** POST /workers/:id/assign-caseworkers — admin assigns caseworkers to a worker. */
export const assignCaseworkersAdmin = async (req, res) => {
  try {
    const { caseworkerIds } = req.body;
    const updated = await assignWorkerCaseworkers(
      req.tenantDb,
      { workerId: req.params.id, caseworkerIds },
      req.user.userId
    );
    res.status(200).json({ status: "success", message: "Caseworkers assigned", data: updated });
  } catch (err) {
    handle(res, err, "Failed to assign caseworkers");
  }
};

/** DELETE /workers/:id — admin soft-deletes a worker (record preserved for compliance). */
export const deleteWorkerAdmin = async (req, res) => {
  try {
    await softDeleteWorker(req.tenantDb, req.params.id, req.user.userId);
    res.status(200).json({ status: "success", message: "Worker record archived" });
  } catch (err) {
    handle(res, err, "Failed to delete worker");
  }
};

/** POST /workers/:id/restore — admin restores a previously soft-deleted worker. */
export const restoreWorkerAdmin = async (req, res) => {
  try {
    const worker = await restoreWorker(req.tenantDb, req.params.id, req.user.userId);
    res.status(200).json({ status: "success", message: "Worker record restored", data: worker });
  } catch (err) {
    handle(res, err, "Failed to restore worker");
  }
};

/** GET /workers/:id/audit — full immutable audit trail. */
export const getWorkerAuditAdmin = async (req, res) => {
  try {
    const trail = await getWorkerAuditTrail(req.tenantDb, req.params.id);
    res.status(200).json({ status: "success", data: trail });
  } catch (err) {
    handle(res, err, "Failed to fetch audit trail");
  }
};
