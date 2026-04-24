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

router.get(
  "/reports/revenue-by-visa-type",
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  reportsController.getRevenueByVisaType
);

router.get(
  "/reports/revenue-by-sponsor",
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  reportsController.getRevenueBySponsor
);

router.get(
  "/caseworkers",
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  reportsController.getAllCaseworkersReport
);

router.get(
  "/caseworkers/:id/report",
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  reportsController.getCaseworkerPerformanceReport
);

router.get(
  "/caseworkers/:id/report/pdf",
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  reportsController.getCaseworkerReportPDF
);

router.get(
  "/caseworkers/filter",
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  reportsController.filterCaseworkers
);

export default router;