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
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

router.use(verifyTokenAndTenant);
// Removed checkRole([ROLES.ADMIN]) so other roles can access their own reports

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
