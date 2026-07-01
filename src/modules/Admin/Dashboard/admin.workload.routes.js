import express from 'express';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES, requirePlanModule } from '../../../middlewares/role.middleware.js';
import workloadController from './workloadMonitoring.controller.js';

const router = express.Router();

// Apply authentication middleware to all workload routes
router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.ADMIN]));
router.use(requirePlanModule('admin.workload'));

// Export Workload CSV
router.get("/export", workloadController.exportWorkloadCSV);

// Workload Overview
router.get("/overview", workloadController.getWorkloadOverview);

// Pending Tasks
router.get("/pending-tasks", workloadController.getPendingTasks);

// Deadline Monitor
router.get("/deadline-monitor", workloadController.getDeadlineMonitor);

// Individual Caseworker Workload
router.get("/caseworker/:caseworkerId", workloadController.getCaseworkerWorkload);

// Workload Trends
router.get("/trends", workloadController.getWorkloadTrends);

// Workload Alerts
router.get("/alerts", workloadController.getWorkloadAlerts);

export default router;
