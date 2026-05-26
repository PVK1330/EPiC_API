import jwt from "jsonwebtoken";
import platformDb from "../models/index.js";
import ApiResponse from "../utils/apiResponse.js";

/**
 * Global token verification against Platform DB users registry.
 */
export const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return ApiResponse.unauthorized(res, "Missing or invalid authorization header");
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "epic-secret-key");

    const user = await platformDb.User.findByPk(decoded.id);
    if (!user) {
      return ApiResponse.unauthorized(res, "User not found");
    }

    if (user.status !== "active") {
      return ApiResponse.forbidden(res, "User account is " + user.status);
    }

    if (user.organisation_id && user.role_id !== 5) {
      const org = await platformDb.Organisation.findByPk(user.organisation_id, {
        attributes: ['status'],
        include: [
          {
            model: platformDb.Subscription,
            as: 'subscriptions',
            where: { status: { [platformDb.Sequelize.Op.in]: ['active', 'trial'] } },
            required: false,
          },
        ],
      });

      if (org?.status === 'suspended') {
        return ApiResponse.forbidden(res, 'Your organisation subscription has expired. Please contact your administrator.');
      }

      if (!org?.subscriptions || org.subscriptions.length === 0) {
        const expiredSub = await platformDb.Subscription.findOne({
          where: { organisation_id: user.organisation_id, status: 'expired' },
        });
        if (expiredSub) {
          return ApiResponse.forbidden(res, 'Your organisation subscription has expired. Please contact your administrator.');
        }
      }
    }

    if (user.password_changed_at) {
      const tokenIssuedAt = decoded.iat * 1000;
      if (new Date(user.password_changed_at).getTime() > tokenIssuedAt) {
        return ApiResponse.unauthorized(res, "Session expired due to password change. Please log in again.");
      }
    }

    user.userId = user.id;
    // Attach role_name from JWT payload so controllers can use it
    user.role_name = decoded.role_name || null;
    req.user = user;
    next();
  } catch (err) {
    return ApiResponse.unauthorized(res, "Token is invalid or expired");
  }
};
