import express from "express";
import { verifyToken } from "../middlewares/auth.middleware.js";
import { checkRole, ROLES } from "../middlewares/role.middleware.js";
import workloadController from "../controllers/AdminControllers/workloadMonitoring.controller.js";

const router = express.Router();

// Apply authentication middleware to all workload routes
router.use(verifyToken);
router.use(checkRole([ROLES.ADMIN]));

// Export Workload CSV
router.get("/export", workloadController.exportWorkloadCSV);

// Workload Overview
router.get("/overview", workloadController.getWorkloadOverview);

// Individual Caseworker Workload
router.get("/caseworker/:caseworkerId", workloadController.getCaseworkerWorkload);

// Workload Trends
router.get("/trends", workloadController.getWorkloadTrends);

// Workload Alerts
router.get("/alerts", workloadController.getWorkloadAlerts);

export default router;
