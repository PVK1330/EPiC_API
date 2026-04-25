import { Router } from "express";
import * as auditLogController from "../controllers/AdminControllers/auditLog.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";
import { checkRole, ROLES } from "../middlewares/role.middleware.js";

const router = Router();

router.use(verifyToken);
router.use(checkRole([ROLES.ADMIN]));

router.get("/", auditLogController.getAuditLogs);
router.get("/actions", auditLogController.getAuditActionTypes);
router.get("/export", auditLogController.exportAuditLogs);

export default router;
