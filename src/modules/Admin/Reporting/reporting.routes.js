import { Router } from 'express';
import {
  getCaseAnalytics,
  getWorkloadReport,
  getFinancialReport,
  getFinancialTransactions,
  getPerformanceReport,
  getReportingSummary,
  exportReportingExcel,
} from './reporting.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES, requirePlanModule } from '../../../middlewares/role.middleware.js';

const router = Router();

router.use(verifyTokenAndTenant);
// S-06 fix: financial and personnel data is restricted to Admin and Caseworker.
// Role-scoped filtering is applied inside each controller via buildRoleWhere(req.user).
router.use(checkRole([ROLES.ADMIN, ROLES.CASEWORKER]));
router.use(requirePlanModule('admin.reports'));

// Summary KPIs (all-in-one for dashboard header)
router.get('/summary', getReportingSummary);

router.get('/export/excel', exportReportingExcel);

// Individual report endpoints (all support ?startDate=&endDate= query params)
router.get('/cases',       getCaseAnalytics);
router.get('/workload',    getWorkloadReport);
router.get('/financial',   getFinancialReport);
router.get('/financial-transactions', getFinancialTransactions);
router.get('/performance', getPerformanceReport);

export default router;
