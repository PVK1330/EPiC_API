import { Router } from "express";
import { requirePlatformPermission } from "../../../middlewares/isPlatformStaff.js";
import ApiResponse from "../../../utils/apiResponse.js";
import { backupSensitiveLimiter, restoreUploadMiddleware } from "../../Shared/Backups/backup.common.js";
import * as c from "./backup.controller.js";

// Mounted at /api/superadmin/backups behind verifyToken + isPlatformStaff +
// requirePlatformPermission(view|manage). Mutating routes additionally need `manage`.
const router = Router();
const manage = requirePlatformPermission("platform.backups.manage");
const superadminOnly = (req, res, next) =>
  req.isPlatformSuperAdmin ? next() : ApiResponse.forbidden(res, "Superadmin access required");

router.get("/", c.listJobs);
router.get("/organisations", c.listOrganisations);
router.post("/", manage, c.createJob);
// Must be declared before the /:id routes.
router.post("/restore", manage, superadminOnly, backupSensitiveLimiter, restoreUploadMiddleware, c.restore);
router.get("/:id", c.getJob);
router.post("/:id/download", manage, backupSensitiveLimiter, c.downloadJob);
router.delete("/:id", manage, c.removeJob);

export default router;
