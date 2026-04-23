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



export default router;
