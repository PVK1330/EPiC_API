import platformDb from "../models/index.js";
import ApiResponse from "../utils/apiResponse.js";
import { verifyToken as verifyJwt } from "../config/jwt.config.js";
import { ROLES } from "./role.middleware.js";
import {
  getCachedOrg,
  setCachedOrg,
} from "../services/orgCache.service.js";

/**
 * Endpoints an org admin may still reach while their subscription is expired,
 * so they can view the renewal page and pay to reactivate. Everything else is
 * gated behind an active subscription. Matched as a prefix on the path.
 */
const SUBSCRIPTION_EXEMPT_PREFIXES = [
  "/api/billing",
  "/api/auth/me",
  "/api/auth/logout",
  "/api/auth/refresh",
];

function isSubscriptionExemptPath(req) {
  const url = (req.originalUrl || req.url || "").split("?")[0];
  return SUBSCRIPTION_EXEMPT_PREFIXES.some((p) => url.startsWith(p));
}

/**
 * Global token verification against Platform DB users registry.
 * Caches organisation status to avoid hitting the DB on every request.
 * JWT secret is validated at startup — no fallback exists.
 */
export const verifyToken = async (req, res, next) => {
  try {
    // Read token from httpOnly cookie first (XSS-resistant),
    // fall back to Authorization header for backward compatibility
    // (impersonation flows, mobile apps, direct API consumers).
    let token = null;

    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }

    if (!token) {
      token = req.cookies?.token;
    }

    if (!token) {
      return ApiResponse.unauthorized(res, "Missing or invalid authorization token");
    }

    const decoded = verifyJwt(token);

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

      const subscriptionExpired =
        orgData.status === "suspended" ||
        (!orgData.hasActiveSub && orgData.hasExpiredSub);

      if (subscriptionExpired) {
        // Org admins may still sign in to self-serve renewal: let them reach the
        // billing/session endpoints, but block every other feature endpoint with
        // a machine-readable code so the frontend can redirect them to pay.
        // All other roles stay hard-blocked until the org is reactivated.
        if (user.role_id === ROLES.ADMIN) {
          req.subscriptionExpired = true;
          if (!isSubscriptionExemptPath(req)) {
            return res.status(403).json({
              status: "error",
              code: "SUBSCRIPTION_EXPIRED",
              message:
                "Your organisation subscription has expired. Please renew to continue.",
              data: null,
            });
          }
        } else {
          return ApiResponse.forbidden(
            res,
            "Your organisation subscription has expired. Please contact your administrator.",
          );
        }
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
    // Plan modules embedded in JWT (present on tokens issued after the
    // requirePlanModule middleware was added; absent on older sessions).
    user.allowedModules = Array.isArray(decoded.allowedModules) ? decoded.allowedModules : null;
    req.user = user;
    next();
  } catch (err) {
    return ApiResponse.unauthorized(res, "Token is invalid or expired");
  }
};
