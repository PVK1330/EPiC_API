import { Router } from 'express';
import {
  getCaseAnalytics,
  getWorkloadReport,
  getFinancialReport,
  getFinancialTransactions,
  getPerformanceReport,
  getReportingSummary,
  exportReportingExcel,
} from '../controllers/AdminControllers/reporting.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { checkRole, ROLES } from '../middlewares/role.middleware.js';

const router = Router();

router.use(verifyToken);
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
