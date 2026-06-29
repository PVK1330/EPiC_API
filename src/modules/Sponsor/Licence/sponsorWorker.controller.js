import logger from "../../../utils/logger.js";
import {
  createSponsoredWorker,
  getSponsoredWorkerById,
  listSponsorWorkers,
  getWorkerAuditTrail,
  softDeleteWorker,
  assignCosToWorker,
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
      cosRequestId, cosAllocationRecordId, useGeneralPool,
      workerFirstName, workerLastName, workerEmail, workerNationality, visaType, notes,
      // UKVI fields
      dob, gender, maritalStatus,
      passportNumber, passportIssueDate, passportExpiryDate, passportCountry,
      phone, address, city,
      jobTitle, department, socCode, startDate, salary, weeklyHours,
      previousUkVisa,
    } = req.body;
    const worker = await createSponsoredWorker(
      req.tenantDb,
      {
        sponsorId: userId,
        organisationId: orgId(req),
        cosRequestId,
        cosAllocationRecordId,
        useGeneralPool: !!useGeneralPool,
        workerFirstName,
        workerLastName,
        workerEmail,
        workerNationality,
        visaType,
        notes,
        // UKVI fields
        dob, gender, maritalStatus,
        passportNumber, passportIssueDate, passportExpiryDate, passportCountry,
        phone, address, city,
        jobTitle, department, socCode, startDate, salary, weeklyHours,
        previousUkVisa,
      },
      userId
    );
    res.status(201).json({ status: "success", message: "Worker registered", data: worker });
  } catch (err) {
    handle(res, err, "Failed to register worker");
  }
};

/** POST /workers/:id/assign-cos — assign a CoS allocation to an existing worker. */
export const assignWorkerCos = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const { cosAllocationRecordId, cosRequestId } = req.body;
    if (!cosAllocationRecordId) {
      return res.status(400).json({ status: "error", message: "cosAllocationRecordId is required" });
    }
    const worker = await assignCosToWorker(
      req.tenantDb,
      { workerId: req.params.id, sponsorId: userId, cosAllocationRecordId, cosRequestId },
      userId
    );
    res.status(200).json({ status: "success", message: "CoS assigned", data: worker });
  } catch (err) {
    handle(res, err, "Failed to assign CoS");
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
