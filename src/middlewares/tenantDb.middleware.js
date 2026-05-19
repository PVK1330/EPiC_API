import platformDb from "../models/index.js";
import { getTenantDb } from "../services/tenantDb.service.js";
import { isSuperAdminRole } from "../utils/tenantScope.js";
import { ROLES, hasFullAccessRole } from "./role.middleware.js";
import { ensureAdminHasAllPermissions } from "../seeders/permission.seeder.js";

/**
 * Attach req.tenantDb for authenticated non-superadmin requests.
 * Superadmin routes use platformDb only (organisations registry).
 */
export async function attachTenantDb(req, res, next) {
  try {
    if (isSuperAdminRole(req.user?.role_id)) {
      req.tenantDb = null;
      return next();
    }

    let orgId = req.user?.organisation_id;
    
    // If admin/caseworker/candidate/business has no organisation, use default
    if (!orgId) {
      const envDefaultOrgId = process.env.DEFAULT_ORGANISATION_ID;
      if (envDefaultOrgId) {
        orgId = parseInt(envDefaultOrgId, 10);
      } else {
        // Fall back to first active organisation
        const defaultOrg = await platformDb.Organisation.findOne({
          where: { status: { [platformDb.Sequelize.Op.in]: ["active", "trial"] } },
          order: [["id", "ASC"]],
        });
        orgId = defaultOrg?.id;
      }
      
      if (!orgId) {
        return res.status(403).json({
          status: "error",
          message: "No organisation on token and no default organisation available.",
          data: null,
        });
      }
    }

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

    if (org.status === "suspended") {
      return res.status(403).json({
        status: "error",
        message: "Organisation suspended.",
        data: null,
      });
    }

    if (!org.database_name) {
      return res.status(500).json({
        status: "error",
        message: "Tenant DB not provisioned. Contact support.",
        data: null,
      });
    }

    req.tenantDb = getTenantDb(org.database_name);

    // Organisation admins always have full access within their tenant
    try {
      if (hasFullAccessRole(req.user.role_id)) {
        await ensureAdminHasAllPermissions(req.tenantDb);
        const allPerms = await req.tenantDb.Permission.findAll({ attributes: ["name"] });
        req.user.permissions = allPerms.map((p) => p.name);
      } else {
        const userWithPermissions = await req.tenantDb.User.findByPk(req.user.id, {
          include: [
            {
              model: req.tenantDb.Role,
              as: "role",
              include: [
                {
                  model: req.tenantDb.Permission,
                  as: "permissions",
                  through: { attributes: [] },
                },
              ],
            },
          ],
        });

        if (userWithPermissions?.role?.permissions) {
          req.user.permissions = userWithPermissions.role.permissions.map((p) => p.name);
        } else {
          req.user.permissions = [];
        }
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
