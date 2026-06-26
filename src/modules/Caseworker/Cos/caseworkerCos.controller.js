import logger from "../../../utils/logger.js";
import { hasFullAccessRole } from "../../../middlewares/role.middleware.js";
import { getPaginationParams, buildPaginationMeta } from "../../../utils/paginate.js";
import {
  listCosRequests,
  getCosRequestById,
  reviewCosRequest,
  requestInfoCosRequest,
  isCaseworkerAssignedToCos,
  getCosAllocationRecord,
} from "../../../services/cosRequest.service.js";

/** CoS requests assigned to the logged-in caseworker (optionally by status). */
export const getMyAssignedCosRequests = async (req, res) => {
  try {
    const caseworkerId = req.user.userId;
    const { page, limit, offset } = getPaginationParams(req.query);
    const { rows, count } = await listCosRequests(req.tenantDb, {
      assignedCaseworkerId: caseworkerId,
      status: req.query.status,
      pagination: { limit, offset },
    });
    res.status(200).json({
      status: "success",
      data: rows,
      pagination: buildPaginationMeta(count, page, limit),
    });
  } catch (error) {
    logger.error({ err: error }, "Error fetching assigned CoS requests");
    res.status(500).json({ status: "error", message: "Failed to fetch assigned CoS requests" });
  }
};

/**
 * Load the request and confirm the caller may review it: an admin override, or
 * the assigned caseworker. Returns the request, or null after sending a
 * 404/403 response.
 */
const loadReviewable = async (req, res) => {
  const request = await getCosRequestById(req.tenantDb, req.params.id);
  if (!request) {
    res.status(404).json({ status: "error", message: "CoS request not found" });
    return null;
  }
  if (hasFullAccessRole(req.user.role_id)) return request;
  if (isCaseworkerAssignedToCos(request, req.user.userId)) return request;
  res.status(403).json({
    status: "error",
    message: "You are not the assigned caseworker for this CoS request.",
  });
  return null;
};

const review = (action) => async (req, res) => {
  try {
    const allowed = await loadReviewable(req, res);
    if (!allowed) return;
    const { approvedAmount, reviewNotes } = req.body;
    const request = await reviewCosRequest({
      tenantDb: req.tenantDb,
      id: req.params.id,
      action,
      approvedAmount,
      reviewNotes,
      reviewerId: req.user.userId,
      req,
    });
    res.status(200).json({
      status: "success",
      message: `CoS request ${action === "approve" ? "approved" : "rejected"}`,
      data: request,
    });
  } catch (error) {
    const code = error?.statusCode || 500;
    if (code >= 500) logger.error({ err: error }, `Error during CoS ${action}`);
    res.status(code).json({ status: "error", message: error.message || `Failed to ${action} CoS request` });
  }
};

export const approveAssignedCosRequest = review("approve");
export const rejectAssignedCosRequest = review("reject");

/** GET /:id/allocation — view the allocation record for an approved CoS request. */
export const getCosAllocationRecordHandler = async (req, res) => {
  try {
    const request = await getCosRequestById(req.tenantDb, req.params.id);
    if (!request) {
      return res.status(404).json({ status: "error", message: "CoS request not found" });
    }
    if (!hasFullAccessRole(req.user.role_id) && !isCaseworkerAssignedToCos(request, req.user.userId)) {
      return res.status(403).json({ status: "error", message: "You are not assigned to this CoS request" });
    }
    const record = await getCosAllocationRecord(req.tenantDb, req.params.id);
    if (!record) {
      return res.status(404).json({ status: "error", message: "No allocation record found — request may not be approved yet" });
    }
    return res.status(200).json({ status: "success", data: record });
  } catch (err) {
    logger.error({ err }, "Error fetching CoS allocation record");
    return res.status(500).json({ status: "error", message: "Failed to fetch allocation record" });
  }
};

export const requestInfoForCosRequest = async (req, res) => {
  try {
    const allowed = await loadReviewable(req, res);
    if (!allowed) return;
    const { reviewNotes } = req.body;
    const request = await requestInfoCosRequest({
      tenantDb: req.tenantDb,
      id: req.params.id,
      reviewNotes,
      reviewerId: req.user.userId,
      req,
    });
    res.status(200).json({
      status: "success",
      message: "Information requested from sponsor",
      data: request,
    });
  } catch (error) {
    const code = error?.statusCode || 500;
    if (code >= 500) logger.error({ err: error }, "Error requesting CoS information");
    res.status(code).json({ status: "error", message: error.message || "Failed to request information" });
  }
};
