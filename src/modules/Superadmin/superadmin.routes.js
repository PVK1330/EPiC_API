import express from 'express';
import { verifyToken } from '../../middlewares/auth.middleware.js';
import { isSuperAdmin } from '../../middlewares/isSuperAdmin.js';
import * as orgController from './superadminOrganisation.controller.js';
import * as planController from './plan.controller.js';
import * as subscriptionController from './subscription.controller.js';
import * as invoiceController from './invoice.controller.js';
import * as paymentController from './payment.controller.js';
import * as moduleController from './module.controller.js';
import { getPlatformSmtpSettings } from '../Admin/Settings/smtp.settings.controller.js';

const router = express.Router();

router.use(verifyToken, isSuperAdmin);

router.get('/organisations', orgController.listOrganisations);
router.get('/organisations/:id', orgController.getOrganisationById);
router.post('/organisations', orgController.createOrganisation);
router.patch('/organisations/:id', orgController.updateOrganisation);
router.delete('/organisations/:id', orgController.deleteOrganisation);
router.post('/organisations/:id/suspend', orgController.suspendOrganisation);
router.post('/organisations/:id/activate', orgController.activateOrganisation);
router.post('/organisations/:id/admins', orgController.createOrganisationAdmin);
router.post('/organisations/:id/impersonate', orgController.impersonateOrganisationAdmin);

router.get('/plans', planController.getAllPlans);
router.get('/plans/:id', planController.getPlanById);
router.post('/plans', planController.createPlan);
router.put('/plans/:id', planController.updatePlan);
router.delete('/plans/:id', planController.deletePlan);

router.get('/subscriptions', subscriptionController.getAllSubscriptions);
router.get('/subscriptions/org/:orgId', subscriptionController.getSubscriptionByOrg);
router.post('/subscriptions', subscriptionController.createSubscription);
router.put('/subscriptions/:id', subscriptionController.updateSubscription);
router.post('/subscriptions/:id/cancel', subscriptionController.cancelSubscription);
router.post('/subscriptions/:id/renew', subscriptionController.renewSubscription);

router.get('/invoices', invoiceController.getAllInvoices);
router.get('/invoices/:id', invoiceController.getInvoiceById);
router.patch('/invoices/:id/status', invoiceController.updateInvoiceStatus);
router.get('/invoices/export/pdf', invoiceController.exportInvoicesPdf);
router.get('/financials/export', invoiceController.exportFinancials);

router.get('/transactions', paymentController.getAllTransactions);
router.get('/transactions/:id', paymentController.getTransactionById);
router.get('/gateway/status', paymentController.getGatewayStatus);
router.post('/gateway/configure', paymentController.configureGateway);
router.get('/dashboard/stats', paymentController.getDashboardStats);

router.get('/audit-log', (req, res) => {
  res.json({ status: 'success', message: 'Global audit log (scaffold)' });
});

router.get('/analytics', (req, res) => {
  res.json({ status: 'success', message: 'Platform analytics (scaffold)' });
});

router.get('/smtp-settings', getPlatformSmtpSettings);

router.get('/modules', moduleController.getAllModules);
router.post('/modules', moduleController.createModule);
router.put('/modules/:id', moduleController.updateModule);
router.delete('/modules/:id', moduleController.deleteModule);
router.get('/plans/:planId/modules', moduleController.getModulesByPlan);
router.put('/plans/:planId/modules', moduleController.updatePlanModules);

export default router;
