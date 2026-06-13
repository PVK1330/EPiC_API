import logger from "../../../utils/logger.js";
import {
  resolveEntity,
  loadRecord,
  listForReview,
  getRecordWithHistory,
  applyReviewAction,
  REVIEW_ACTIONS,
} from "../../../services/complianceReview.service.js";

const handle = (res, err, fallback) => {
  const code = err?.statusCode || 500;
  if (code >= 500) logger.error({ err }, fallback);
  return res.status(code).json({ status: "error", message: err.message || fallback });
};

/** List items of one entity type for the review queue (optional ?status, ?sponsorId). */
export const listComplianceReview = async (req, res) => {
  try {
    const cfg = resolveEntity(req.params.entityType);
    const data = await listForReview(req.tenantDb, cfg, {
      reviewStatus: req.query.status,
      sponsorId: req.query.sponsorId,
    });
    res.status(200).json({ status: "success", data });
  } catch (err) {
    handle(res, err, "Failed to list compliance items");
  }
};

/** One item + its full review history. */
export const getComplianceReview = async (req, res) => {
  try {
    const cfg = resolveEntity(req.params.entityType);
    const result = await getRecordWithHistory(req.tenantDb, cfg, req.params.id);
    if (!result) return res.status(404).json({ status: "error", message: "Record not found" });
    res.status(200).json({ status: "success", data: result });
  } catch (err) {
    handle(res, err, "Failed to fetch compliance item");
  }
};

const reviewAction = (action) => async (req, res) => {
  try {
    const cfg = resolveEntity(req.params.entityType);
    const record = await loadRecord(req.tenantDb, cfg, req.params.id);
    if (!record) return res.status(404).json({ status: "error", message: "Record not found" });

    await applyReviewAction({
      tenantDb: req.tenantDb,
      cfg,
      record,
      action,
      reviewerId: req.user.userId,
      notes: req.body?.notes ?? null,
      req,
    });

    res.status(200).json({
      status: "success",
      message: `${cfg.label} ${record.reviewStatus.toLowerCase()}`,
      data: record,
    });
  } catch (err) {
    handle(res, err, `Failed to ${action} compliance item`);
  }
};

export const startComplianceReview = reviewAction(REVIEW_ACTIONS.REVIEW);
export const approveComplianceReview = reviewAction(REVIEW_ACTIONS.APPROVE);
export const rejectComplianceReview = reviewAction(REVIEW_ACTIONS.REJECT);
export const requestComplianceInfo = reviewAction(REVIEW_ACTIONS.REQUEST_INFO);
