import ApiResponse from '../utils/apiResponse.js';

export const ROLES = {
  CANDIDATE: 1,
  CASEWORKER: 2,
  ADMIN: 3,
  BUSINESS: 4,
  SPONSOR: 4, // Alias for business
  SUPERADMIN: 5,
};

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

    if (allowedRoles.includes(req.user.role_id)) {
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
