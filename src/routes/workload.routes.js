import { Router } from "express";
import * as workloadController from "../controllers/AdminControllers/workload.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";
import { checkRole, ROLES } from "../middlewares/role.middleware.js";
import * as reportsController from "../controllers/AdminControllers/reports.controller.js";

const router = Router();

// Apply authentication to all workload routes
router.use(verifyToken);

router.get(
  "/team-workload",
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  workloadController.getTeamWorkload
);

router.get(
  "/pending-tasks",
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  workloadController.getPendingTasks
);

router.get(
  "/deadline-monitor",
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  workloadController.getDeadlineMonitor
);


router.get(
  "/caseworker/:id/performance",
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  workloadController.getCaseworkerPerformance
);

// Export endpoints for CSV reports
router.get(
  "/export/team-workload",
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  workloadController.exportTeamWorkloadCSV
);

router.get(
  "/export/pending-tasks",
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  workloadController.exportPendingTasksCSV
);

router.get(
  "/export/deadline-monitor",
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  workloadController.exportDeadlineMonitorCSV
);

// Combined export endpoint - All reports in one CSV
router.get(
  "/export-report",
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  workloadController.exportCombinedReport
);

export default router;
