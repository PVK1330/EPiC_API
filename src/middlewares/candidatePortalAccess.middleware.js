/**
 * Week 6: 30-day post-closure candidate portal access rule.
 *
 * A candidate loses portal access 30 days after ALL their cases are Closed.
 * If they still have at least one non-Closed case (or a case closed within 30 days)
 * access is granted normally.
 */
import ApiResponse from '../utils/apiResponse.js';
import logger from '../utils/logger.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const enforcePortalClosureRule = async (req, res, next) => {
  const tenantDb = req.tenantDb;
  const userId = req.user?.userId;

  if (!tenantDb || !userId) return next();

  try {
    const Case = tenantDb.Case;
    if (!Case) return next();

    const cases = await Case.findAll({
      where: { candidateId: userId },
      attributes: ['id', 'status', 'closed_at'],
      paranoid: false,
    });

    if (!cases.length) return next();

    const now = Date.now();
    const hasCaseWithAccess = cases.some((c) => {
      if (c.status !== 'Closed') return true;
      const closedAt = c.closed_at ? new Date(c.closed_at).getTime() : null;
      if (!closedAt) return true;
      return now - closedAt < THIRTY_DAYS_MS;
    });

    if (!hasCaseWithAccess) {
      return ApiResponse.forbidden(
        res,
        'Your portal access has expired. All your cases were closed more than 30 days ago. Please contact your immigration adviser.',
        { code: 'PORTAL_ACCESS_EXPIRED' }
      );
    }

    return next();
  } catch (err) {
    logger.error({ err }, 'candidatePortalAccess: error checking portal access rule');
    return next();
  }
};
