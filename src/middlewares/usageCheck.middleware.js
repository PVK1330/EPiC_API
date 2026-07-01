import { checkPlanLimit, incrementUsage } from "../services/usageMeter.service.js";
import logger from "../utils/logger.js";

/**
 * Factory — checks a plan limit before allowing the request, then increments on success.
 * Usage: router.post('/cases', checkUsageLimit('cases_created'), createCase)
 */
export const checkUsageLimit = (field) => async (req, res, next) => {
  const orgId = req.user?.organisation_id;
  if (!orgId) return next();

  try {
    const result = await checkPlanLimit(orgId, field);
    if (result.exceeded) {
      return res.status(402).json({
        status: "error",
        code: "PLAN_LIMIT_EXCEEDED",
        message: `You have reached the ${field.replace("_", " ")} limit for your current plan (${result.limit}). Please upgrade to continue.`,
        limit: result.limit,
        used: result.used,
      });
    }
    // Attach increment callback so the route can call it after successful creation
    req.recordUsage = () => incrementUsage(orgId, field).catch(() => {});
    next();
  } catch (err) {
    logger.warn({ err, orgId, field }, "usageCheck middleware error");
    next(); // fail open — don't block requests on metering errors
  }
};
