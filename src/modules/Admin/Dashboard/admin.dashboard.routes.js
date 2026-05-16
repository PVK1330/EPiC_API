import express from 'express';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';
import * as dashboardController from './dashboard.controller.js';

const router = express.Router();

// Apply authentication middleware to all dashboard routes
router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.ADMIN]));

// Dashboard Statistics
router.get("/stats", dashboardController.getDashboardStats);

// Recent Activities
router.get("/recent-cases", dashboardController.getRecentCases);
router.get("/recent-tasks", dashboardController.getRecentTasks);
router.get("/recent-activities", dashboardController.getRecentActivities);

// Quick Actions
router.get("/quick-actions", dashboardController.getQuickActions);

// Export Snapshot
router.get("/export-snapshot", dashboardController.exportDashboardSnapshot);
router.get("/export-pdf", dashboardController.exportDashboardPDF);

export default router;
