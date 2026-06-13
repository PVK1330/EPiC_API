import ApiResponse from "../utils/apiResponse.js";
import logger from "../utils/logger.js";
import { recordAuditLog } from "../services/audit.service.js";
import { ROLES, hasFullAccessRole } from "./role.middleware.js";
import { isCaseworkerAssigned } from "../services/licenceAssignment.service.js";

/**
 * Strict caseworker-assignment guard for licence application review actions.
 *
 * Authorises a request when the caller is EITHER:
 *   - an Admin / Superadmin (override), OR
 *   - a Caseworker whose id is in the application's `assignedcaseworkerId` list.
 *
 * Anyone else (including caseworkers who are not assigned) is denied with HTTP
 * 403, and the denied attempt is written to the audit log. The loaded
 * application is attached as `req.licenceApplication` so the downstream handler
 * does not need to re-query.
 *
 * Must run AFTER verifyTokenAndTenant (needs req.user + req.tenantDb).
 *
 * @param {object} [options]
 * @param {string} [options.idParam='id'] route param holding the application id
 */
export const ensureAssignedCaseworker = (options = {}) => {
  const { idParam = "id" } = options;

  return async (req, res, next) => {
    try {
      if (!req.user || !req.tenantDb) {
        return ApiResponse.unauthorized(res, "Authentication required");
      }

      const applicationId = req.params?.[idParam];
      const application = await req.tenantDb.LicenceApplication.findByPk(applicationId);
      if (!application) {
        return ApiResponse.notFound(res, "Licence application not found");
      }

      // Admin / Superadmin may override and act on any application.
      if (hasFullAccessRole(req.user.role_id)) {
        req.licenceApplication = application;
        return next();
      }

      // The assigned caseworker may proceed.
      if (
        Number(req.user.role_id) === ROLES.CASEWORKER &&
        isCaseworkerAssigned(application, req.user.userId)
      ) {
        req.licenceApplication = application;
        return next();
      }

      // Denied — record the attempt (fire-and-forget) and refuse with 403.
      recordAuditLog({
        tenantDb: req.tenantDb,
        userId: req.user.userId ?? null,
        action: "LICENCE_REVIEW_DENIED",
        resource: "licence_application",
        status: "Failed",
        details: JSON.stringify({
          applicationId: application.id,
          reason: "Caseworker is not assigned to this licence application",
          roleId: req.user.role_id ?? null,
          method: req.method,
          path: req.originalUrl,
        }),
        req,
      }).catch((err) =>
        logger.error({ err }, "Failed to audit denied licence review attempt")
      );

      return ApiResponse.forbidden(
        res,
        "You are not the assigned caseworker for this licence application."
      );
    } catch (err) {
      logger.error({ err }, "ensureAssignedCaseworker error");
      return ApiResponse.error(res, "Failed to verify caseworker assignment", 500, err);
    }
  };
};

export default ensureAssignedCaseworker;
