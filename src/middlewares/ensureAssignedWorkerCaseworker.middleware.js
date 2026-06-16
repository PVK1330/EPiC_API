import ApiResponse from "../utils/apiResponse.js";
import logger from "../utils/logger.js";
import { recordAuditLog } from "../services/audit.service.js";
import { ROLES, hasFullAccessRole } from "./role.middleware.js";
import { getSponsoredWorkerById, isCaseworkerAssigned } from "../services/sponsoredWorker.service.js";

/**
 * Strict caseworker-assignment guard for sponsored worker mutations.
 *
 * Authorises a request when the caller is EITHER:
 *   - an Admin / Superadmin (override), OR
 *   - a Caseworker whose id is in the worker's `assignedCaseworkerIds` list.
 *
 * Anyone else (including caseworkers who are not assigned) is denied with HTTP
 * 403. The loaded worker is attached as `req.sponsoredWorker` so the downstream
 * handler does not need to re-query.
 *
 * Must run AFTER verifyTokenAndTenant (needs req.user + req.tenantDb).
 *
 * @param {object} [options]
 * @param {string} [options.idParam='id'] route param holding the worker id
 */
export const ensureAssignedWorkerCaseworker = (options = {}) => {
  const { idParam = "id" } = options;

  return async (req, res, next) => {
    try {
      if (!req.user || !req.tenantDb) {
        return ApiResponse.unauthorized(res, "Authentication required");
      }

      const workerId = req.params?.[idParam];
      const worker = await getSponsoredWorkerById(req.tenantDb, workerId);
      if (!worker) {
        return ApiResponse.notFound(res, "Sponsored worker not found");
      }

      // Admin / Superadmin may override and act on any worker.
      if (hasFullAccessRole(req.user.role_id)) {
        req.sponsoredWorker = worker;
        return next();
      }

      // The assigned caseworker may proceed.
      if (
        Number(req.user.role_id) === ROLES.CASEWORKER &&
        isCaseworkerAssigned(worker, req.user.userId)
      ) {
        req.sponsoredWorker = worker;
        return next();
      }

      // Denied — record the attempt (fire-and-forget) and refuse with 403.
      recordAuditLog({
        tenantDb: req.tenantDb,
        userId: req.user.userId ?? null,
        action: "WORKER_MUTATION_DENIED",
        resource: "sponsored_worker",
        status: "Failed",
        details: JSON.stringify({
          workerId: worker.id,
          reason: "Caseworker is not assigned to this sponsored worker",
          roleId: req.user.role_id ?? null,
          method: req.method,
          path: req.originalUrl,
        }),
        req,
      }).catch((err) =>
        logger.error({ err }, "Failed to audit denied worker mutation attempt")
      );

      return ApiResponse.forbidden(
        res,
        "You are not the assigned caseworker for this sponsored worker."
      );
    } catch (err) {
      logger.error({ err }, "ensureAssignedWorkerCaseworker error");
      return ApiResponse.error(res, "Failed to verify caseworker assignment", 500, err);
    }
  };
};

export default ensureAssignedWorkerCaseworker;
