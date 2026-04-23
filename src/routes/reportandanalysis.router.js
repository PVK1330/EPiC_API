import express from "express";
import * as workloadController from "../controllers/AdminControllers/workload.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";
import { checkRole, ROLES } from "../middlewares/role.middleware.js";
import * as reportsController from "../controllers/AdminControllers/reports.controller.js";

const router = express.Router();


// Reports
router.get(
  "/reports/case-types",
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  reportsController.getCaseTypeReport
);

router.get(
  "/reports/workload",
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  reportsController.getWorkloadReport
);

export default router;