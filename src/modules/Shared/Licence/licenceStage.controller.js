import logger from "../../../utils/logger.js";
import { ROLES } from "../../../middlewares/role.middleware.js";
import {
  getStagesForApplication,
  completeStageTask,
} from "../../../services/licenceStageTask.service.js";

/**
 * Shared controller for the Sponsor Licence "stages" panel, mounted under the
 * admin, caseworker and sponsor licence routers. Access is enforced per scope:
 *   - Admin router: admin-role guard (router-level).
 *   - Caseworker router: ensureAssignedCaseworker middleware (attaches req.licenceApplication).
 *   - Sponsor router: ownership check below (a sponsor only sees their own application).
 */

async function loadAccessibleApplication(req) {
  // The caseworker route's ensureAssignedCaseworker middleware preloads this.
  if (req.licenceApplication) return req.licenceApplication;
  return req.tenantDb.LicenceApplication.findByPk(req.params.id);
}

const ALLOWED_ROLES = new Set([ROLES.BUSINESS, ROLES.CASEWORKER, ROLES.ADMIN, ROLES.SUPERADMIN]);

/**
 * Scope guard. Router-level middleware already enforces the role for each mount
 * (admin checkRole, caseworker ensureAssignedCaseworker, sponsor BUSINESS role);
 * this adds defence-in-depth so the shared controller never serves an
 * unexpected role, and enforces sponsor row-ownership.
 */
function assertScopeAccess(req, application) {
  const rid = Number(req.user?.role_id);
  if (!ALLOWED_ROLES.has(rid)) {
    const e = new Error("Forbidden");
    e.statusCode = 403;
    throw e;
  }
  // A sponsor (BUSINESS role) may only touch their own application.
  if (rid === ROLES.BUSINESS && application.userId !== req.user.userId) {
    const e = new Error("Licence application not found");
    e.statusCode = 404;
    throw e;
  }
}

export const getLicenceStages = async (req, res) => {
  try {
    const application = await loadAccessibleApplication(req);
    if (!application) {
      return res.status(404).json({ status: "error", message: "Licence application not found" });
    }
    assertScopeAccess(req, application);

    const data = await getStagesForApplication(req.tenantDb, application, { req });
    return res.status(200).json({ status: "success", data });
  } catch (error) {
    const code = error?.statusCode || 500;
    if (code >= 500) logger.error({ err: error }, "getLicenceStages failed");
    return res.status(code).json({ status: "error", message: error.message || "Failed to load stages" });
  }
};

export const completeLicenceStageTask = async (req, res) => {
  try {
    const { stageKey } = req.params;
    const { role } = req.body || {};
    if (!role) {
      return res.status(400).json({ status: "error", message: "role is required" });
    }

    const application = await loadAccessibleApplication(req);
    if (!application) {
      return res.status(404).json({ status: "error", message: "Licence application not found" });
    }
    assertScopeAccess(req, application);

    await completeStageTask(req.tenantDb, {
      applicationId: application.id,
      stageKey,
      role,
      actorUser: req.user,
      req,
    });

    // Return the refreshed panel so the client can re-render in one round-trip.
    const data = await getStagesForApplication(req.tenantDb, application, { req });
    return res.status(200).json({ status: "success", message: "Task completed", data });
  } catch (error) {
    const code = error?.statusCode || 500;
    if (code >= 500) logger.error({ err: error }, "completeLicenceStageTask failed");
    return res.status(code).json({ status: "error", message: error.message || "Failed to complete task" });
  }
};
