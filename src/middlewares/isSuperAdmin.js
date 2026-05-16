import ApiResponse from "../utils/apiResponse.js";

/**
 * Ensures the authenticated user has a Superadmin role (role_id: 5).
 */
export const isSuperAdmin = (req, res, next) => {
  if (req.user && req.user.role_id === 5) {
    return next();
  }
  return ApiResponse.forbidden(res, "Superadmin access required");
};
