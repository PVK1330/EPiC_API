import logger from "../../../utils/logger.js";
import {
  createSponsoredWorker,
  getSponsoredWorkerById,
  listSponsorWorkers,
  getWorkerAuditTrail,
  softDeleteWorker,
} from "../../../services/sponsoredWorker.service.js";

const uid = (req) => {
  const n = Number(req.user?.userId);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};

const orgId = (req) =>
  req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;

const handle = (res, err, fallback) => {
  const code = err?.statusCode || 500;
  if (code >= 500) logger.error({ err }, fallback);
  return res.status(code).json({ status: "error", message: err.message || fallback });
};

/** GET /workers — list sponsor's own workers. */
export const listMyWorkers = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const workers = await listSponsorWorkers(req.tenantDb, userId);
    res.status(200).json({ status: "success", data: workers });
  } catch (err) {
    handle(res, err, "Failed to fetch workers");
  }
};

/** GET /workers/:id — sponsor views one of their own worker records. */
export const getMyWorker = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const worker = await getSponsoredWorkerById(req.tenantDb, req.params.id);
    if (!worker) return res.status(404).json({ status: "error", message: "Worker not found" });
    if (worker.sponsorId !== userId) return res.status(403).json({ status: "error", message: "Forbidden" });
    res.status(200).json({ status: "success", data: worker });
  } catch (err) {
    handle(res, err, "Failed to fetch worker");
  }
};

/** POST /workers — sponsor registers a new sponsored worker. */
export const registerWorker = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const {
      cosRequestId, cosAllocationRecordId,
      workerFirstName, workerLastName, workerEmail, workerNationality, visaType, notes,
    } = req.body;
    const worker = await createSponsoredWorker(
      req.tenantDb,
      {
        sponsorId: userId,
        organisationId: orgId(req),
        cosRequestId,
        cosAllocationRecordId,
        workerFirstName,
        workerLastName,
        workerEmail,
        workerNationality,
        visaType,
        notes,
      },
      userId
    );
    res.status(201).json({ status: "success", message: "Worker registered", data: worker });
  } catch (err) {
    handle(res, err, "Failed to register worker");
  }
};

/** DELETE /workers/:id — sponsor soft-deletes one of their own workers. */
export const deleteMyWorker = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const worker = await getSponsoredWorkerById(req.tenantDb, req.params.id);
    if (!worker) return res.status(404).json({ status: "error", message: "Worker not found" });
    if (worker.sponsorId !== userId) return res.status(403).json({ status: "error", message: "Forbidden" });
    await softDeleteWorker(req.tenantDb, req.params.id, userId);
    res.status(200).json({ status: "success", message: "Worker record archived" });
  } catch (err) {
    handle(res, err, "Failed to delete worker");
  }
};

/** GET /workers/:id/audit — sponsor reads audit trail for their own worker. */
export const getMyWorkerAudit = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const worker = await getSponsoredWorkerById(req.tenantDb, req.params.id);
    if (!worker) return res.status(404).json({ status: "error", message: "Worker not found" });
    if (worker.sponsorId !== userId) return res.status(403).json({ status: "error", message: "Forbidden" });
    const trail = await getWorkerAuditTrail(req.tenantDb, req.params.id);
    res.status(200).json({ status: "success", data: trail });
  } catch (err) {
    handle(res, err, "Failed to fetch audit trail");
  }
};
