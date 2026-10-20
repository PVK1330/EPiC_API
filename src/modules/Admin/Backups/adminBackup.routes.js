import { Router } from "express";
import { verifyTokenAndTenant } from "../../../middlewares/authStack.middleware.js";
import { checkRole, ROLES } from "../../../middlewares/role.middleware.js";
import { backupSensitiveLimiter, restoreUploadMiddleware } from "../../Shared/Backups/backup.common.js";
import * as c from "./adminBackup.controller.js";

// Mounted at /api/admin/backups. Same middleware order as the audit-logs admin module.
const router = Router();

router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.ADMIN]));

router.get("/status", c.getStatus);
router.get("/", c.listJobs);
router.post("/", c.requireDownloadEnabled, c.createJob);
// Must be declared before the /:id routes.
router.post("/restore", c.requireRestoreEnabled, backupSensitiveLimiter, restoreUploadMiddleware, c.restore);
router.get("/:id", c.getJob);
router.post("/:id/download", c.requireDownloadEnabled, backupSensitiveLimiter, c.downloadJob);
router.delete("/:id", c.removeJob);

export default router;
