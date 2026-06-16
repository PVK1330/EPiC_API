import logger from "../../../utils/logger.js";
import { hasFullAccessRole } from "../../../middlewares/role.middleware.js";
import {
  createSponsoredWorker,
  advanceWorkerStage,
  grantWorkerVisa,
  rejectWorkerVisa,
  assignWorkerCaseworkers,
  getSponsoredWorkerById,
  listCaseworkerWorkers,
  getWorkerAuditTrail,
  isCaseworkerAssigned,
  verifyCaseworkerWorkerOwnership,
} from "../../../services/sponsoredWorker.service.js";

const handle = (res, err, fallback) => {
  const code = err?.statusCode || 500;
  if (code >= 500) logger.error({ err }, fallback);
  return res.status(code).json({ status: "error", message: err.message || fallback });
};

/** Verify the caller may act on this worker (admin override OR assigned caseworker). */
const loadWorker = async (req, res) => {
  if (req.sponsoredWorker) return req.sponsoredWorker;
  const worker = await getSponsoredWorkerById(req.tenantDb, req.params.id);
  if (!worker) {
    res.status(404).json({ status: "error", message: "Sponsored worker not found" });
    return null;
  }
  if (hasFullAccessRole(req.user.role_id)) return worker;
  if (isCaseworkerAssigned(worker, req.user.userId)) return worker;
  res.status(403).json({ status: "error", message: "You are not assigned to this worker" });
  return null;
};

/** GET /workers — list workers assigned to the calling caseworker. */
export const getMyWorkers = async (req, res) => {
  try {
    const workers = await listCaseworkerWorkers(req.tenantDb, req.user.userId);
    res.status(200).json({ status: "success", data: workers });
  } catch (err) {
    handle(res, err, "Failed to fetch assigned workers");
  }
};

/** GET /workers/:id — get a single worker. */
export const getWorkerHandler = async (req, res) => {
  try {
    const worker = await loadWorker(req, res);
    if (!worker) return;
    res.status(200).json({ status: "success", data: worker });
  } catch (err) {
    handle(res, err, "Failed to fetch worker");
  }
};

/** POST /workers — create a sponsored worker (caseworker or admin). */
export const createWorkerHandler = async (req, res) => {
  try {
    const {
      sponsorId, organisationId, cosRequestId, cosAllocationRecordId,
      workerFirstName, workerLastName, workerEmail, workerNationality, visaType, notes,
    } = req.body;

    if (!hasFullAccessRole(req.user.role_id)) {
      const isAllowed = await verifyCaseworkerWorkerOwnership(
        req.tenantDb,
        { sponsorId, cosRequestId, cosAllocationRecordId },
        req.user.userId
      );
      if (!isAllowed) {
        return res.status(403).json({
          status: "error",
          message: "You are not authorized to register workers for this sponsor/application.",
        });
      }
    }

    const worker = await createSponsoredWorker(
      req.tenantDb,
      { sponsorId, organisationId, cosRequestId, cosAllocationRecordId, workerFirstName, workerLastName, workerEmail, workerNationality, visaType, notes },
      req.user.userId
    );
    res.status(201).json({ status: "success", message: "Sponsored worker created", data: worker });
  } catch (err) {
    handle(res, err, "Failed to create sponsored worker");
  }
};

/** POST /workers/:id/advance — move to the next pipeline stage. */
export const advanceStageHandler = async (req, res) => {
  try {
    const worker = await loadWorker(req, res);
    if (!worker) return;
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

/** POST /workers/:id/grant-visa — record Visa Granted decision. */
export const grantVisaHandler = async (req, res) => {
  try {
    const worker = await loadWorker(req, res);
    if (!worker) return;
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

/** POST /workers/:id/reject-visa — record Visa Rejected decision. */
export const rejectVisaHandler = async (req, res) => {
  try {
    const worker = await loadWorker(req, res);
    if (!worker) return;
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

/** POST /workers/:id/assign-caseworkers — update assigned caseworkers. */
export const assignCaseworkersHandler = async (req, res) => {
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

/** GET /workers/:id/audit — full audit trail for one worker. */
export const getAuditTrailHandler = async (req, res) => {
  try {
    const worker = await loadWorker(req, res);
    if (!worker) return;
    const trail = await getWorkerAuditTrail(req.tenantDb, req.params.id);
    res.status(200).json({ status: "success", data: trail });
  } catch (err) {
    handle(res, err, "Failed to fetch audit trail");
  }
};
