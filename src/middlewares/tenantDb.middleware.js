import platformDb from "../models/index.js";
import { getTenantDb } from "../services/tenantDb.service.js";
import { isPlatformStaffUser, isSuperAdminRole } from "../utils/tenantScope.js";
import { hasFullAccessRole } from "./role.middleware.js";
import logger from "../utils/logger.js";
import {
  getCachedOrg,
  setCachedOrg,
  getCachedPermissions,
  setCachedPermissions,
} from "../services/orgCache.service.js";

/**
 * Attach req.tenantDb for authenticated non-superadmin requests.
 * Uses cached org lookups (from auth middleware or local cache) to avoid
 * repeated platform DB queries. Caches permissions per user for 2 min.
 *
 * Token validation paths
 * ──────────────────────
 * A. SUPERADMIN (role_id=5, organisation_id=null)
 *    Platform-level user; intentionally carries no tenant scope.
 *    req.tenantDb is set to null and the request proceeds — superadmin
 *    routes are responsible for resolving the target organisation themselves.
 *
 * B. Non-superadmin with null / missing / invalid organisation_id
 *    Hard 403. There is NO fallback (no env-var lookup, no "first active org"
 *    query). A missing organisation_id is always a sign of a malformed or
 *    forged token; silently inheriting an arbitrary tenant is a data-isolation
 *    violation.
 *
 * C. Regular tenant user (organisation_id present and positive)
 *    Org record is fetched (or served from cache), status is checked, the
 *    per-tenant Sequelize instance is attached as req.tenantDb, and the
 *    user's role permissions are loaded.
 */
export async function attachTenantDb(req, res, next) {
  try {
    // ── Path A: Platform superadmin — no tenant scope ─────────────────────────
    // isPlatformStaffUser is true for any user with organisation_id == null.
    // We add an explicit SUPERADMIN role check so that a regular user whose
    // token somehow omits organisation_id does not silently inherit the
    // platform-staff bypass — they hit Path B instead.
    if (isPlatformStaffUser(req.user)) {
      if (!isSuperAdminRole(req.user?.role_id)) {
        logger.warn(
          { userId: req.user?.id, role_id: req.user?.role_id },
          "attachTenantDb: non-superadmin token missing organisation_id — rejected",
        );
        return res.status(403).json({
          status: "error",
          message:
            "Token does not contain an organisation identifier. Re-authenticate and try again.",
          data: null,
        });
      }
      req.tenantDb = null;
      return next();
    }

    // ── Path B: Validate organisation_id — no fallback ────────────────────────
    // A missing, empty, zero, or non-numeric organisation_id is always an error.
    // Never fall back to an env variable or the first active organisation: doing
    // so could route the request to a completely unrelated tenant's database.
    const rawOrgId = req.user?.organisation_id;
    const orgId =
      rawOrgId != null && rawOrgId !== "" ? Number(rawOrgId) : NaN;

    if (!Number.isFinite(orgId) || orgId <= 0) {
      logger.warn(
        { userId: req.user?.id, rawOrgId },
        "attachTenantDb: token missing valid organisation_id — rejected",
      );
      return res.status(403).json({
        status: "error",
        message:
          "Token does not contain a valid organisation identifier. Re-authenticate and try again.",
        data: null,
      });
    }

    // ── Path C: Resolve and validate the tenant ───────────────────────────────
    let orgData = req._orgData || getCachedOrg(orgId);

    if (!orgData) {
      const org = await platformDb.Organisation.findByPk(orgId, {
        attributes: ["database_name", "status"],
      });

      if (!org) {
        return res.status(403).json({
          status: "error",
          message: "Organisation not found.",
          data: null,
        });
      }

      orgData = { status: org.status, database_name: org.database_name };
      setCachedOrg(orgId, orgData);
    }

    // A suspended org normally can't reach tenant-scoped routes. The exception is
    // an org admin whom verifyToken has cleared for self-serve renewal
    // (req.subscriptionExpired) on an exempt endpoint (e.g. /api/auth/me): the
    // tenant DB still exists, so attach it and let the request through.
    if (orgData.status === "suspended" && !req.subscriptionExpired) {
      return res.status(403).json({
        status: "error",
        message: "Organisation suspended.",
        data: null,
      });
    }

    if (!orgData.database_name) {
      return res.status(500).json({
        status: "error",
        message: "Tenant DB not provisioned. Contact support.",
        data: null,
      });
    }

    req.tenantDb = getTenantDb(orgData.database_name);

    // ── Permissions ───────────────────────────────────────────────────────────
    try {
      if (hasFullAccessRole(req.user.role_id)) {
        const permCacheKey = `admin:${orgId}`;
        let perms = getCachedPermissions(permCacheKey);
        if (!perms) {
          const allPerms = await req.tenantDb.Permission.findAll({
            attributes: ["name"],
          });
          perms = allPerms.map((p) => p.name);
          setCachedPermissions(permCacheKey, perms);
        }
        req.user.permissions = perms;
      } else {
        const permCacheKey = `user:${orgId}:${req.user.id}`;
        let perms = getCachedPermissions(permCacheKey);
        if (!perms) {
          const userWithPermissions = await req.tenantDb.User.findByPk(
            req.user.id,
            {
              attributes: ["id"],
              include: [
                {
                  model: req.tenantDb.Role,
                  as: "role",
                  attributes: ["id"],
                  include: [
                    {
                      model: req.tenantDb.Permission,
                      as: "permissions",
                      attributes: ["name"],
                      through: { attributes: [] },
                    },
                  ],
                },
              ],
            },
          );

          perms = userWithPermissions?.role?.permissions
            ? userWithPermissions.role.permissions.map((p) => p.name)
            : [];
          setCachedPermissions(permCacheKey, perms);
        }
        req.user.permissions = perms;
      }
    } catch (permErr) {
      logger.error({ err: permErr }, "Error loading tenant permissions");
      req.user.permissions = hasFullAccessRole(req.user.role_id) ? ["*"] : [];
    }

    next();
  } catch (err) {
    next(err);
  }
}
