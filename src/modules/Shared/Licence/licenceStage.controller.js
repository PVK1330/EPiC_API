import path from "path";
import fs from "fs";
import logger from "../../../utils/logger.js";
import { ROLES } from "../../../middlewares/role.middleware.js";
import {
  getStagesForApplication,
  completeStageTask,
} from "../../../services/licenceStageTask.service.js";
import { getWorkflowTimeline } from "../../../services/licenceWorkflowTimeline.service.js";
import { resolveLicenceDocumentPaths } from "../../../utils/licenceDocuments.util.js";

const PRIVATE_STORAGE_DIR = path.resolve(process.cwd(), "storage/private");
const INLINE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"];

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

/**
 * GET .../:id/documents/:index/download — stream one of an application's uploaded
 * documents (the `documents` JSON array of disk paths) through this authenticated
 * route. Shared by caseworker (assignment-guarded) and sponsor (ownership-guarded);
 * confined to storage/private to block traversal. Mirrors the admin handler.
 */
export const downloadLicenceDocument = async (req, res) => {
  try {
    const { index } = req.params;
    const application = await loadAccessibleApplication(req);
    if (!application) {
      return res.status(404).json({ status: "error", message: "Licence application not found" });
    }
    assertScopeAccess(req, application);

    // V2-aware: merge V1 JSON `documents` with V2 `licence_appendix_documents`
    // file paths so the index-based download works for both application versions.
    const docs = await resolveLicenceDocumentPaths(req.tenantDb, application);
    const i = Number.parseInt(index, 10);
    if (Number.isNaN(i) || i < 0 || i >= docs.length || !docs[i]) {
      return res.status(404).json({ status: "error", message: "Document not found" });
    }

    const absolute = path.resolve(String(docs[i]));
    if (absolute !== PRIVATE_STORAGE_DIR && !absolute.startsWith(PRIVATE_STORAGE_DIR + path.sep)) {
      return res.status(400).json({ status: "error", message: "Invalid document path" });
    }
    if (!fs.existsSync(absolute)) {
      return res.status(404).json({ status: "error", message: "File no longer exists on the server" });
    }

    const filename = path.basename(absolute);
    const ext = path.extname(filename).toLowerCase();
    const forceDownload = req.query.download === "1";
    const disposition = forceDownload || !INLINE_EXTENSIONS.includes(ext) ? "attachment" : "inline";

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);
    return res.sendFile(absolute, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ status: "error", message: "Error streaming document" });
      }
    });
  } catch (error) {
    const code = error?.statusCode || 500;
    if (code >= 500) logger.error({ err: error }, "downloadLicenceDocument (shared) failed");
    return res.status(code).json({ status: "error", message: error.message || "Failed to download document" });
  }
};

/**
 * GET .../:id/workflow-timeline — the full cross-entity workflow timeline
 * (licence + CoS + sponsored workers) for one application, chronologically.
 * Shared across admin, caseworker (assignment-guarded) and sponsor (owner-guarded).
 */
export const getLicenceWorkflowTimeline = async (req, res) => {
  try {
    const application = await loadAccessibleApplication(req);
    if (!application) {
      return res.status(404).json({ status: "error", message: "Licence application not found" });
    }
    assertScopeAccess(req, application);

    const timeline = await getWorkflowTimeline(req.tenantDb, application);
    return res.status(200).json({ status: "success", data: { applicationId: application.id, timeline } });
  } catch (error) {
    const code = error?.statusCode || 500;
    if (code >= 500) logger.error({ err: error }, "getLicenceWorkflowTimeline failed");
    return res.status(code).json({ status: "error", message: error.message || "Failed to load workflow timeline" });
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
