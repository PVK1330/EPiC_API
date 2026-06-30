import { Router } from 'express';
import * as financeController from './adminFinance.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES, requirePlanModule } from '../../../middlewares/role.middleware.js';

const router = Router();

router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.ADMIN]));
router.use(requirePlanModule('admin.finance'));

// Summary KPIs
router.get('/summary', financeController.getFinanceSummary);

// Reconciliation
router.get('/reconciliation', financeController.getPaymentReconciliation);

// Transactions list + detail
router.get('/transactions',          financeController.getTransactions);
router.get('/transactions/:id',      financeController.getTransactionById);
router.patch('/transactions/:id/status', financeController.updateTransactionStatus);

// Invoice creation
router.post('/invoices', financeController.createInvoice);

// CSV export
router.get('/export/csv', financeController.exportTransactionsCsv);

export default router;
