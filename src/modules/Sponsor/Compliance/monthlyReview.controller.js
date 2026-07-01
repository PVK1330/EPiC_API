/**
 * Monthly Compliance Review Controller — Section N
 *
 * Mounted under /api/business/compliance/monthly-reviews
 * Auth: BUSINESS (sponsor) role only — enforced by the Sponsor panel router.
 *
 * GET  /                  — paginated list of past monthly reviews for this sponsor
 * GET  /:id               — single review with full five-section payload
 * POST /generate          — manually trigger a monthly review for this sponsor
 */

import logger from "../../../utils/logger.js";
import { getPaginationParams, buildPaginationMeta } from "../../../utils/paginate.js";
import { generateSponsorMonthlyReport } from "../../../services/monthlyComplianceReport.service.js";

const uid = (req) => {
  const n = Number(req.user?.userId);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};

/**
 * GET /api/business/compliance/monthly-reviews
 * Returns a paginated list of monthly compliance reviews for the authenticated
 * sponsor, newest first. Full payload is omitted from the list for efficiency —
 * use GET /:id to fetch it.
 */
export const listMonthlyReviews = async (req, res) => {
  try {
    const sponsorId = uid(req);
    if (!sponsorId) {
      return res.status(401).json({ status: "error", message: "Invalid session" });
    }

    const { page, limit, offset } = getPaginationParams(req.query);

    const { count, rows } = await req.tenantDb.MonthlyComplianceReview.findAndCountAll({
      where: { sponsorId },
      attributes: [
        "id",
        "reportMonth",
        "totalWorkers",
        "highRiskCount",
        "mediumRiskCount",
        "workersExpiringIn90Days",
        "missingDocumentCount",
        "riskScore",
        "riskScoreDelta",
        "generatedBy",
        "created_at",
      ],
      order: [["report_month", "DESC"]],
      limit,
      offset,
    });

    return res.status(200).json({
      status: "success",
      data: {
        reviews: rows,
        pagination: buildPaginationMeta(count, page, limit),
      },
    });
  } catch (err) {
    logger.error({ err }, "listMonthlyReviews error");
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
};

/**
 * GET /api/business/compliance/monthly-reviews/:id
 * Returns a single monthly review with its full five-section payload.
 */
export const getMonthlyReview = async (req, res) => {
  try {
    const sponsorId = uid(req);
    if (!sponsorId) {
      return res.status(401).json({ status: "error", message: "Invalid session" });
    }

    const { id } = req.params;
    const review = await req.tenantDb.MonthlyComplianceReview.findOne({
      where: { id, sponsorId },
    });

    if (!review) {
      return res.status(404).json({ status: "error", message: "Monthly review not found" });
    }

    return res.status(200).json({ status: "success", data: review });
  } catch (err) {
    logger.error({ err }, "getMonthlyReview error");
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
};

/**
 * POST /api/business/compliance/monthly-reviews/generate
 * Manually trigger a monthly compliance review for the authenticated sponsor.
 * Useful for on-demand reporting outside the scheduled cron.
 *
 * Body (optional): { reportDate: "YYYY-MM-DD" }
 *   Defaults to today (i.e. the current calendar month).
 */
export const generateMonthlyReview = async (req, res) => {
  try {
    const sponsorId = uid(req);
    if (!sponsorId) {
      return res.status(401).json({ status: "error", message: "Invalid session" });
    }

    const organisationId = Number(req.user?.organisation_id) || null;
    if (!organisationId) {
      return res.status(400).json({ status: "error", message: "Organisation context missing" });
    }

    // Allow an explicit month override (e.g. re-generate last month's report).
    let reportDate = new Date();
    if (req.body?.reportDate) {
      const parsed = new Date(req.body.reportDate);
      if (!Number.isNaN(parsed.getTime())) reportDate = parsed;
    }

    const report = await generateSponsorMonthlyReport({
      tenantDb: req.tenantDb,
      sponsorId,
      organisationId,
      reportDate,
      generatedBy: "manual",
    });

    return res.status(201).json({
      status: "success",
      message: "Monthly compliance review generated successfully",
      data: report,
    });
  } catch (err) {
    logger.error({ err }, "generateMonthlyReview error");
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
};
