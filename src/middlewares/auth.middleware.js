import jwt from "jsonwebtoken";
import platformDb from "../models/index.js";
import ApiResponse from "../utils/apiResponse.js";
import {
  getCachedOrg,
  setCachedOrg,
} from "../services/orgCache.service.js";

/**
 * Global token verification against Platform DB users registry.
 * Caches organisation status to avoid hitting the DB on every request.
 */
export const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return ApiResponse.unauthorized(res, "Missing or invalid authorization header");
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "epic-secret-key");

    const user = await platformDb.User.findByPk(decoded.id, {
      attributes: [
        "id", "email", "first_name", "last_name", "role_id",
        "organisation_id", "status", "password_changed_at",
      ],
    });
    if (!user) {
      return ApiResponse.unauthorized(res, "User not found");
    }

    if (user.status !== "active") {
      return ApiResponse.forbidden(res, "User account is " + user.status);
    }

    if (user.organisation_id && user.role_id !== 5) {
      const orgId = user.organisation_id;
      let orgData = getCachedOrg(orgId);

      if (!orgData) {
        const org = await platformDb.Organisation.findByPk(orgId, {
          attributes: ["id", "status", "database_name"],
          include: [
            {
              model: platformDb.Subscription,
              as: "subscriptions",
              where: {
                status: {
                  [platformDb.Sequelize.Op.in]: ["active", "trial"],
                },
              },
              required: false,
              attributes: ["id", "status"],
            },
          ],
        });
        orgData = {
          status: org?.status ?? null,
          database_name: org?.database_name ?? null,
          hasActiveSub: org?.subscriptions?.length > 0,
        };

        if (!orgData.hasActiveSub) {
          const expiredSub = await platformDb.Subscription.findOne({
            where: { organisation_id: orgId, status: "expired" },
            attributes: ["id"],
          });
          orgData.hasExpiredSub = !!expiredSub;
        }

        setCachedOrg(orgId, orgData);
      }

      if (orgData.status === "suspended") {
        return ApiResponse.forbidden(
          res,
          "Your organisation subscription has expired. Please contact your administrator.",
        );
      }

      if (!orgData.hasActiveSub && orgData.hasExpiredSub) {
        return ApiResponse.forbidden(
          res,
          "Your organisation subscription has expired. Please contact your administrator.",
        );
      }

      req._orgData = orgData;
    }

    if (user.password_changed_at) {
      const tokenIssuedAt = decoded.iat * 1000;
      if (new Date(user.password_changed_at).getTime() > tokenIssuedAt) {
        return ApiResponse.unauthorized(
          res,
          "Session expired due to password change. Please log in again.",
        );
      }
    }

    user.userId = user.id;
    user.role_name = decoded.role_name || null;
    req.user = user;
    next();
  } catch (err) {
    return ApiResponse.unauthorized(res, "Token is invalid or expired");
  }
};
