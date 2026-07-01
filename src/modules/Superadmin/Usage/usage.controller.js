import platformDb from "../../../models/index.js";
import {
  getCurrentUsage,
  getUsageSummary,
  getUsageHistory,
  getPlanLimits,
} from "../../../services/usageMeter.service.js";
import logger from "../../../utils/logger.js";

/** GET /superadmin/usage — platform-wide usage overview */
export const getPlatformUsageOverview = async (req, res) => {
  try {
    const orgs = await platformDb.Organisation.findAll({
      where: { deleted_at: null },
      attributes: ["id", "name", "slug"],
      include: [{ model: platformDb.Plan, as: "plan", attributes: ["id", "name"] }],
    });

    const summaries = await Promise.all(
      orgs.map(async (org) => {
        const summary = await getUsageSummary(org.id).catch(() => null);
        return { organisation: { id: org.id, name: org.name, slug: org.slug, plan: org.plan?.name }, usage: summary };
      })
    );

    res.json({ status: "success", data: summaries });
  } catch (err) {
    logger.error({ err }, "getPlatformUsageOverview error");
    res.status(500).json({ status: "error", message: "Failed to fetch platform usage" });
  }
};

/** GET /superadmin/usage/:orgId — single organisation usage */
export const getOrganisationUsage = async (req, res) => {
  try {
    const orgId = Number(req.params.orgId);
    const months = Number(req.query.months) || 6;

    const [summary, history, limits] = await Promise.all([
      getUsageSummary(orgId),
      getUsageHistory(orgId, months),
      getPlanLimits(orgId),
    ]);

    res.json({ status: "success", data: { summary, history, limits } });
  } catch (err) {
    logger.error({ err }, "getOrganisationUsage error");
    res.status(500).json({ status: "error", message: "Failed to fetch organisation usage" });
  }
};

/** GET /superadmin/usage/alerts — orgs at 80%+ usage */
export const getUsageAlerts = async (req, res) => {
  try {
    const orgs = await platformDb.Organisation.findAll({
      where: { deleted_at: null },
      attributes: ["id", "name"],
    });

    const alerts = [];
    for (const org of orgs) {
      const summary = await getUsageSummary(org.id).catch(() => null);
      if (!summary) continue;
      const exceeded = Object.entries(summary).filter(
        ([, v]) => v.level === "warning" || v.level === "critical" || v.level === "exceeded"
      );
      if (exceeded.length) {
        alerts.push({
          organisation: { id: org.id, name: org.name },
          alerts: exceeded.map(([field, v]) => ({ field, level: v.level, pct: v.pct, used: v.used, limit: v.limit })),
        });
      }
    }

    res.json({ status: "success", data: alerts });
  } catch (err) {
    logger.error({ err }, "getUsageAlerts error");
    res.status(500).json({ status: "error", message: "Failed to fetch usage alerts" });
  }
};
