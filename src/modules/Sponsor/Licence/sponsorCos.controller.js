import logger from "../../../utils/logger.js";
import catchAsync from "../../../utils/catchAsync.js";
import apiResponse from "../../../utils/apiResponse.js";
import { rowsToXlsxBuffer, sendXlsxDownload } from "../../../utils/excelExport.util.js";
import {
  createCosRequest,
  listSponsorCosRequests,
  updateSponsorCosRequest,
  deleteSponsorCosRequest,
  getCosSummary as getCosSummaryService,
  getCosAllocationRecord,
  listSponsorAllocationRecords,
} from "../../../services/cosRequest.service.js";

const uid = (req) => {
  const n = Number(req.user?.userId);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};

const orgId = (req) =>
  req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;

const handleError = (res, err, fallback) => {
  const status = err?.statusCode || 500;
  if (status >= 500) logger.error({ err }, fallback);
  return res.status(status).json({ status: "error", message: err.message || fallback });
};

export const getCosSummary = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const data = await getCosSummaryService(req.tenantDb, userId);
    res.status(200).json({ status: "success", data });
  } catch (err) {
    handleError(res, err, "Failed to fetch CoS summary");
  }
};

export const requestCosAllocation = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const { visaType, requestedAmount, reason } = req.body;
    const request = await createCosRequest({
      tenantDb: req.tenantDb,
      sponsorId: userId,
      organisationId: orgId(req),
      visaType,
      requestedAmount,
      reason,
      req,
    });
    res.status(201).json({ status: "success", message: "CoS allocation request submitted", data: request });
  } catch (err) {
    handleError(res, err, "Failed to submit CoS allocation request");
  }
};

export const getCosRequests = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const requests = await listSponsorCosRequests(req.tenantDb, userId);
    res.status(200).json({ status: "success", data: requests });
  } catch (err) {
    handleError(res, err, "Failed to fetch CoS requests");
  }
};

export const updateCosRequest = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const { visaType, requestedAmount, reason } = req.body;
    const request = await updateSponsorCosRequest({
      tenantDb: req.tenantDb,
      sponsorId: userId,
      id: req.params.id,
      visaType,
      requestedAmount,
      reason,
    });
    res.status(200).json({ status: "success", message: "Request updated", data: request });
  } catch (err) {
    handleError(res, err, "Failed to update CoS request");
  }
};

export const deleteCosRequest = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    await deleteSponsorCosRequest({ tenantDb: req.tenantDb, sponsorId: userId, id: req.params.id });
    res.status(200).json({ status: "success", message: "Request deleted" });
  } catch (err) {
    handleError(res, err, "Failed to delete CoS request");
  }
};

/** GET /requests/:id/allocation — sponsor views their own allocation record for one request. */
export const getCosAllocationRecordForSponsor = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const record = await getCosAllocationRecord(req.tenantDb, req.params.id);
    if (!record) {
      return res.status(404).json({ status: "error", message: "No allocation record found for this request" });
    }
    // Sponsors may only view their own records.
    if (record.sponsorId !== userId) {
      return res.status(403).json({ status: "error", message: "Forbidden" });
    }
    return res.status(200).json({ status: "success", data: record });
  } catch (err) {
    handleError(res, err, "Failed to fetch CoS allocation record");
  }
};

/** GET /allocations — list all allocation records for the sponsor. */
export const listMyAllocationRecords = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const records = await listSponsorAllocationRecords(req.tenantDb, userId);
    return res.status(200).json({ status: "success", data: records });
  } catch (err) {
    handleError(res, err, "Failed to fetch CoS allocation records");
  }
};

export const exportCosSummary = catchAsync(async (req, res) => {
  const userId = uid(req);
  if (!userId) return apiResponse(res, 401, "error", "Invalid session");

  const { byVisaType } = await getCosSummaryService(req.tenantDb, userId);
  const rows = byVisaType.map((i) => ({
    visaType: i.visaType,
    allocated: i.allocated,
    used: i.used,
    remaining: i.remaining,
    expiryDate: i.expiryDate ? new Date(i.expiryDate).toLocaleDateString("en-GB") : "N/A",
  }));
  const columns = [
    { key: "visaType", header: "Visa Type" },
    { key: "allocated", header: "Allocated" },
    { key: "used", header: "Used" },
    { key: "remaining", header: "Remaining" },
    { key: "expiryDate", header: "Expiry Date" },
  ];
  const buffer = rowsToXlsxBuffer(rows, columns);
  sendXlsxDownload(res, buffer, `cos_summary_${new Date().toISOString().split("T")[0]}.xlsx`);
});

export const exportCosRequests = catchAsync(async (req, res) => {
  const userId = uid(req);
  if (!userId) return apiResponse(res, 401, "error", "Invalid session");

  const requests = await listSponsorCosRequests(req.tenantDb, userId);
  const rows = requests.map((r) => ({
    id: r.id,
    visaType: r.visaType || "N/A",
    requestedAmount: r.requestedAmount || 0,
    approvedAmount: r.approvedAmount ?? "—",
    status: r.status || "Pending",
    reason: r.reason || "",
    createdAt: new Date(r.created_at).toLocaleDateString("en-GB"),
    reviewedAt: r.reviewedAt ? new Date(r.reviewedAt).toLocaleDateString("en-GB") : "—",
  }));
  const columns = [
    { key: "id", header: "Request ID" },
    { key: "visaType", header: "Visa Type" },
    { key: "requestedAmount", header: "Requested" },
    { key: "approvedAmount", header: "Approved" },
    { key: "status", header: "Status" },
    { key: "reason", header: "Reason" },
    { key: "createdAt", header: "Created" },
    { key: "reviewedAt", header: "Reviewed" },
  ];
  const buffer = rowsToXlsxBuffer(rows, columns);
  sendXlsxDownload(res, buffer, `cos_requests_${new Date().toISOString().split("T")[0]}.xlsx`);
});
