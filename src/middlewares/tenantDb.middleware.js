import platformDb from "../models/index.js";
import { getTenantDb } from "../services/tenantDb.service.js";
import { isPlatformStaffUser } from "../utils/tenantScope.js";
import { hasFullAccessRole } from "./role.middleware.js";
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
 */
export async function attachTenantDb(req, res, next) {
  try {
    if (isPlatformStaffUser(req.user)) {
      req.tenantDb = null;
      return next();
    }

    let orgId = req.user?.organisation_id;

    if (!orgId) {
      const envDefaultOrgId = process.env.DEFAULT_ORGANISATION_ID;
      if (envDefaultOrgId) {
        orgId = parseInt(envDefaultOrgId, 10);
      } else {
        const defaultOrg = await platformDb.Organisation.findOne({
          where: {
            status: {
              [platformDb.Sequelize.Op.in]: ["active", "trial"],
            },
          },
          order: [["id", "ASC"]],
          attributes: ["id"],
        });
        orgId = defaultOrg?.id;
      }

      if (!orgId) {
        return res.status(403).json({
          status: "error",
          message:
            "No organisation on token and no default organisation available.",
          data: null,
        });
      }
    }

    let orgData = req._orgData || getCachedOrg(orgId);

    if (!orgData) {
      const org = await platformDb.Organisation.findByPk(orgId, {
        attributes: ["database_name", "status"],
      });
      orgData = {
        status: org?.status ?? null,
        database_name: org?.database_name ?? null,
      };
      setCachedOrg(orgId, orgData);
    }

    if (!orgData || orgData.status === "suspended") {
      return res.status(403).json({
        status: "error",
        message: orgData ? "Organisation suspended." : "Organisation not found.",
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
      console.error("Error loading tenant permissions:", permErr);
      req.user.permissions = hasFullAccessRole(req.user.role_id) ? ["*"] : [];
    }

    next();
  } catch (err) {
    next(err);
  }
}
