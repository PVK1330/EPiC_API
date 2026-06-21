import platformDb from "../models/index.js";
import ApiResponse from "../utils/apiResponse.js";
import { isPlatformSuperAdminRole } from "../utils/tenantScope.js";

/**
 * Platform staff: users with organisation_id IS NULL (superadmin panel).
 * Attaches req.platformUser, req.platformPermissions, req.isPlatformSuperAdmin.
 */
export const isPlatformStaff = async (req, res, next) => {
  try {
    if (!req.user?.id) {
      return ApiResponse.forbidden(res, "Platform access required");
    }

    const user = await platformDb.User.findByPk(req.user.id, {
      attributes: ["id", "organisation_id", "role_id", "status", "email"],
      include: [
        {
          model: platformDb.Role,
          as: "role",
          attributes: ["id", "name", "scope"],
          include: [
            {
              model: platformDb.Permission,
              as: "permissions",
              attributes: ["name"],
              through: { attributes: [] },
            },
          ],
        },
      ],
    });

    // BUG-051: a null organisation_id alone is not sufficient — also require the
    // user's role to be platform-scoped. Otherwise a user whose organisation_id
    // was cleared but who holds a tenant role could reach superadmin endpoints.
    if (!user || user.organisation_id != null || user.role?.scope !== "platform") {
      return ApiResponse.forbidden(res, "Platform access required");
    }

    if (user.status !== "active") {
      return ApiResponse.forbidden(res, "Account is inactive");
    }

    req.platformUser = user;
    req.platformPermissions = (user.role?.permissions || []).map((p) => p.name);
    req.isPlatformSuperAdmin = isPlatformSuperAdminRole(user.role_id);
    return next();
  } catch (err) {
    return next(err);
  }
};

export const requirePlatformPermission =
  (...permissionNames) =>
  (req, res, next) => {
    if (req.isPlatformSuperAdmin) return next();
    const has = permissionNames.some((p) => req.platformPermissions?.includes(p));
    if (has) return next();
    return ApiResponse.forbidden(res, "Insufficient platform permissions");
  };

/** @deprecated Use isPlatformStaff */
export const isSuperAdmin = isPlatformStaff;
