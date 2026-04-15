import { Router } from "express";
import * as caseDetailController from "../controllers/AdminControllers/caseDetail.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";
import { checkRole, ROLES } from "../middlewares/role.middleware.js";

const router = Router();

// Require authentication for all routes
router.use(verifyToken);

// Apply role-based access control
router.use(checkRole([ROLES.ADMIN, ROLES.CASEWORKER]));

// Case Detail Routes
router.get("/:id", caseDetailController.getCaseDetails);
router.patch("/:id/status", caseDetailController.updateCaseStatus);

export default router;
