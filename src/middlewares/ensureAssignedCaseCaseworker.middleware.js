import ApiResponse from "../utils/apiResponse.js";
import logger from "../utils/logger.js";
import { recordAuditLog } from "../services/audit.service.js";
import { ROLES, hasFullAccessRole } from "./role.middleware.js";

/**
 * Caseworker-assignment guard for shared Workflow case-action routes
 * (backend-authz-12). These routes were gated by role only, so ANY caseworker
 * could issue CCLs, record visa decisions, upload decision documents, mark a
 * case completed or read the full workflow bundle (candidate PII) for cases
 * they were never assigned to.
 *
 * Authorises when the caller is EITHER:
 *   - an Admin / Superadmin (override — platform-wide access), OR
 *   - a Caseworker whose userId is in Case.assignedcaseworkerId (JSONB array).
 *
 * Must run AFTER verifyTokenAndTenant (needs req.user + req.tenantDb) and is
 * intended to sit behind checkRole([ADMIN, CASEWORKER]).
 *
 * @param {object} [options]
 * @param {string} [options.idParam='caseId'] route param holding the case ref
 */
export const ensureAssignedCaseCaseworker = (options = {}) => {
  const { idParam = "caseId" } = options;

  return async (req, res, next) => {
    try {
      if (!req.user || !req.tenantDb) {
        return ApiResponse.unauthorized(res, "Authentication required");
      }

      // Admin / Superadmin may act on any case — no DB load needed.
      if (hasFullAccessRole(req.user.role_id)) return next();

      // Only caseworkers reach here (route-level checkRole restricts others).
      const caseRef = req.params?.[idParam];
      const numeric = parseInt(caseRef, 10);
      const caseRecord =
        (await req.tenantDb.Case.findOne({
          where: { caseId: String(caseRef) },
          attributes: ["id", "caseId", "assignedcaseworkerId"],
        })) ||
        (!Number.isNaN(numeric)
          ? await req.tenantDb.Case.findByPk(numeric, {
              attributes: ["id", "caseId", "assignedcaseworkerId"],
            })
          : null);

      if (!caseRecord) {
        return ApiResponse.notFound(res, "Case not found");
      }

      // assignedcaseworkerId is a JSONB array of assigned caseworker user IDs
      // (may hold numbers or numeric strings).
      const assigned = caseRecord.assignedcaseworkerId;
      const ids = Array.isArray(assigned) ? assigned : assigned ? [assigned] : [];
      if (
        Number(req.user.role_id) === ROLES.CASEWORKER &&
        ids.map(Number).includes(Number(req.user.userId))
      ) {
        return next();
      }

      recordAuditLog({
        tenantDb: req.tenantDb,
        userId: req.user.userId ?? null,
        action: "CASE_ACTION_DENIED",
        resource: "workflow_case",
        status: "Failed",
        details: JSON.stringify({
          caseId: caseRecord.id,
          reason: "Caseworker is not assigned to this case",
          roleId: req.user.role_id ?? null,
          method: req.method,
          path: req.originalUrl,
        }),
        req,
      }).catch((err) =>
        logger.error({ err }, "Failed to audit denied case-action attempt")
      );

      return ApiResponse.forbidden(
        res,
        "You are not assigned to this case."
      );
    } catch (err) {
      logger.error({ err }, "ensureAssignedCaseCaseworker error");
      return ApiResponse.error(res, "Failed to verify case assignment", 500, err);
    }
  };
};

export default ensureAssignedCaseCaseworker;
