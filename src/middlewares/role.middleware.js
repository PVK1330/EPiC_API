import ApiResponse from '../utils/apiResponse.js';
import { recordAuditLog } from '../services/audit.service.js';
import logger from '../utils/logger.js';

export const ROLES = {
  CANDIDATE: 1,
  CASEWORKER: 2,
  ADMIN: 3,
  BUSINESS: 4,
  SPONSOR: 4, // Alias for business
  SUPERADMIN: 5,
};

/**
 * Normalise a raw role_id value from a JWT payload to a safe integer.
 * JWT libraries may serialise numeric fields as strings ("3" instead of 3),
 * so every comparison against the ROLES constants must go through this helper.
 * Returns NaN when the value cannot be converted to a positive finite integer
 * (null, undefined, "abc", negative numbers, Infinity).
 */
function toRoleId(raw) {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : NaN;
}

/**
 * Canonical role arrays for router-level checkRole() guards.
 *
 * Using named exports rather than inline literals ensures that SUPERADMIN is
 * never accidentally omitted from a route file, and that adding a new
 * privileged role requires a change in only one place.
 *
 *   ADMIN_ROLES  — routes restricted to organisation admins and the platform
 *                  superadmin (e.g. admin licence management).
 *   STAFF_ROLES  — routes open to caseworkers, admins, and superadmin
 *                  (e.g. caseworker review panel; inner guards such as
 *                  ensureAssignedCaseworker provide the per-application check).
 */
export const ADMIN_ROLES = [ROLES.ADMIN, ROLES.SUPERADMIN];
export const STAFF_ROLES = [ROLES.CASEWORKER, ROLES.ADMIN, ROLES.SUPERADMIN];

/** Organisation admins and platform superadmins have unrestricted access. */
export function hasFullAccessRole(roleId) {
  const id = Number(roleId);
  return id === ROLES.ADMIN || id === ROLES.SUPERADMIN;
}

/**
 * Middleware to check if the authenticated user has one of the required roles.
 * @param {Array<number>} allowedRoles 
 */
export const checkRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return ApiResponse.unauthorized(res, "Authentication required");
    }

    const roleId = toRoleId(req.user.role_id);
    if (Number.isNaN(roleId)) {
      return ApiResponse.forbidden(res, "Token contains an invalid role identifier");
    }

    if (allowedRoles.includes(roleId)) {
      return next();
    }

    return ApiResponse.forbidden(res, "You do not have permission to access this resource");
  };
};

/**
 * Middleware to check if the user has a specific permission.
 * @param {string} permission 
 */
export const checkPermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) return ApiResponse.unauthorized(res, "Authentication required");
    
    if (hasFullAccessRole(req.user.role_id)) return next();

    const userPermissions = req.user.permissions || [];
    if (userPermissions.includes(permission)) {
      return next();
    }

    return ApiResponse.forbidden(res, `Missing required permission: ${permission}`);
  };
};

/**
 * Middleware to check if the user has AT LEAST ONE of the required permissions.
 * @param {Array<string>} permissions 
 */
export const checkAnyPermission = (permissions) => {
  return (req, res, next) => {
    if (!req.user) return ApiResponse.unauthorized(res, "Authentication required");

    if (hasFullAccessRole(req.user.role_id)) return next();

    const userPermissions = req.user.permissions || [];
    const hasAny = permissions.some(p => userPermissions.includes(p));

    if (hasAny) {
      return next();
    }

    return ApiResponse.forbidden(res, "You do not have any of the required permissions for this action");
  };
};

/**
 * Authorize a request when the caller either holds one of `allowedRoles`
 * (unconditional access) OR is the owner of the targeted resource
 * (the id route param equals their own user id). Anyone else is denied with
 * 403 Forbidden, and the denied attempt is recorded in the audit log.
 *
 * This is the reusable guard for self-service endpoints that privileged staff
 * may also reach on behalf of others, while preventing candidates (or any
 * non-privileged role) from reaching another user's record (IDOR).
 *
 * @param {Array<number>} [allowedRoles=[]] - roles granted unconditional access
 * @param {Object} [options]
 * @param {string} [options.idParam='id'] - route param holding the target user id
 * @param {string} [options.resource='candidate'] - label used in the audit log
 * @returns {import('express').RequestHandler}
 */
export const ensureSelfOrRole = (allowedRoles = [], options = {}) => {
  const { idParam = 'id', resource = 'candidate' } = options;

  return (req, res, next) => {
    if (!req.user) {
      return ApiResponse.unauthorized(res, "Authentication required");
    }

    // Privileged roles (e.g. admin / caseworker) get through unconditionally.
    // Normalise to a number so "3" (string from JWT) matches ROLES.ADMIN (3).
    // NaN falls through naturally — the self-access check below still applies.
    const roleId = toRoleId(req.user.role_id);
    if (!Number.isNaN(roleId) && allowedRoles.includes(roleId)) {
      return next();
    }

    // Otherwise the caller may only act on their OWN record. Compare as strings
    // because route params are always strings while userId may be numeric.
    const targetId = String(req.params?.[idParam] ?? "");
    const selfId = String(req.user.userId ?? req.user.id ?? "");
    if (targetId !== "" && selfId !== "" && targetId === selfId) {
      return next();
    }

    // Denied: record the attempt (fire-and-forget; never blocks the response)
    // and refuse with 403.
    const denial = {
      reason: "Unauthorized cross-account access attempt (IDOR)",
      method: req.method,
      path: req.originalUrl,
      targetId: req.params?.[idParam] ?? null,
      roleId: req.user.role_id ?? null,
    };

    recordAuditLog({
      tenantDb: req.tenantDb,
      userId: req.user.userId ?? req.user.id ?? null,
      action: "ACCESS_DENIED",
      resource,
      status: "Failed",
      details: JSON.stringify(denial),
      req,
    }).catch((err) => logger.error({ err }, "Failed to audit denied access"));

    logger.warn(
      { userId: denial.targetId, actor: req.user.userId ?? req.user.id, ...denial },
      "Denied unauthorized access attempt",
    );

    return ApiResponse.forbidden(res, "You do not have permission to access this resource");
  };
};
