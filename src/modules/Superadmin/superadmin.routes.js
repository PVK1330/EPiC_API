import express from 'express';
import { verifyToken } from '../../middlewares/auth.middleware.js';
import { isPlatformStaff, requirePlatformPermission } from '../../middlewares/isPlatformStaff.js';
import * as teamController from './superadminTeam.controller.js';
import * as orgController from './superadminOrganisation.controller.js';
import * as planController from './plan.controller.js';
import * as subscriptionController from './subscription.controller.js';
import * as invoiceController from './invoice.controller.js';
import * as paymentController from './payment.controller.js';
import * as moduleController from './module.controller.js';
import * as announcementController from './superadminAnnouncement.controller.js';
import { getPlatformSmtpSettings } from '../Admin/Settings/smtp.settings.controller.js';
import * as platformSettingsController from './platformSettings.controller.js';
import * as profileController from './superadminProfile.controller.js';
import { handlePlatformLogoUpload, handlePlatformFaviconUpload, handleSuperadminAvatarUpload } from '../../middlewares/upload.middleware.js';
import * as platformAuditLogController from './platformAuditLog.controller.js';
import * as platformNotificationController from './platformNotification.controller.js';
import * as platformNotificationPrefsController from './platformNotificationPreferences.controller.js';

const router = express.Router();

router.use(verifyToken, isPlatformStaff);

router.get('/team/modules', requirePlatformPermission('platform.team.view', 'platform.team.manage'), teamController.listPlatformModules);
router.get('/team', requirePlatformPermission('platform.team.view', 'platform.team.manage'), teamController.listTeamMembers);
router.post('/team', requirePlatformPermission('platform.team.manage'), teamController.inviteTeamMember);
router.patch('/team/:id', requirePlatformPermission('platform.team.manage'), teamController.updateTeamMember);
router.delete('/team/:id', requirePlatformPermission('platform.team.manage'), teamController.deleteTeamMember);

router.get('/platform-roles', requirePlatformPermission('platform.team.view', 'platform.team.manage'), teamController.listPlatformRoles);
router.post('/platform-roles', requirePlatformPermission('platform.team.manage'), teamController.createPlatformRole);
router.patch('/platform-roles/:id', requirePlatformPermission('platform.team.manage'), teamController.updatePlatformRole);
router.delete('/platform-roles/:id', requirePlatformPermission('platform.team.manage'), teamController.deletePlatformRole);

router.post('/announcements', requirePlatformPermission('platform.dashboard.view'), announcementController.createPlatformAnnouncement);

router.get('/organisations', requirePlatformPermission('platform.organisations.view', 'platform.organisations.manage'), orgController.listOrganisations);
router.get('/organisations/:id', requirePlatformPermission('platform.organisations.view', 'platform.organisations.manage'), orgController.getOrganisationById);
router.post('/organisations', requirePlatformPermission('platform.organisations.manage'), orgController.createOrganisation);
router.post('/organisations/with-admin', requirePlatformPermission('platform.organisations.manage'), orgController.createOrganisationWithAdmin);
router.patch('/organisations/:id', requirePlatformPermission('platform.organisations.manage'), orgController.updateOrganisation);
router.delete('/organisations/:id', requirePlatformPermission('platform.organisations.manage'), orgController.deleteOrganisation);
router.post('/organisations/:id/suspend', requirePlatformPermission('platform.organisations.manage'), orgController.suspendOrganisation);
router.post('/organisations/:id/activate', requirePlatformPermission('platform.organisations.manage'), orgController.activateOrganisation);
router.post('/organisations/:id/admins', requirePlatformPermission('platform.organisations.manage'), orgController.createOrganisationAdmin);
router.post('/organisations/:id/impersonate', requirePlatformPermission('platform.organisations.manage'), orgController.impersonateOrganisationAdmin);

router.get('/plans', requirePlatformPermission('platform.plans.view', 'platform.plans.manage'), planController.getAllPlans);
router.get('/plans/:id', requirePlatformPermission('platform.plans.view', 'platform.plans.manage'), planController.getPlanById);
router.post('/plans', requirePlatformPermission('platform.plans.manage'), planController.createPlan);
router.put('/plans/:id', requirePlatformPermission('platform.plans.manage'), planController.updatePlan);
router.delete('/plans/:id', requirePlatformPermission('platform.plans.manage'), planController.deletePlan);

router.get('/subscriptions', requirePlatformPermission('platform.billing.view'), subscriptionController.getAllSubscriptions);
router.get('/subscriptions/org/:orgId', requirePlatformPermission('platform.billing.view'), subscriptionController.getSubscriptionByOrg);
router.post('/subscriptions', requirePlatformPermission('platform.billing.view'), subscriptionController.createSubscription);
router.put('/subscriptions/:id', requirePlatformPermission('platform.billing.view'), subscriptionController.updateSubscription);
router.post('/subscriptions/:id/cancel', requirePlatformPermission('platform.billing.view'), subscriptionController.cancelSubscription);
router.post('/subscriptions/:id/renew', requirePlatformPermission('platform.billing.view'), subscriptionController.renewSubscription);

router.get('/invoices', requirePlatformPermission('platform.billing.view'), invoiceController.getAllInvoices);
router.get('/invoices/export/pdf', requirePlatformPermission('platform.billing.view'), invoiceController.exportInvoicesPdf);
router.get('/invoices/:id', requirePlatformPermission('platform.billing.view'), invoiceController.getInvoiceById);
router.get('/invoices/:id/download', requirePlatformPermission('platform.billing.view'), invoiceController.downloadInvoicePdf);
router.patch('/invoices/:id/status', requirePlatformPermission('platform.billing.view'), invoiceController.updateInvoiceStatus);
router.get('/financials/export', requirePlatformPermission('platform.billing.view'), invoiceController.exportFinancials);


import { validate } from '../../middlewares/validate.middleware.js';
import { configureGatewaySchema } from '../../validations/superadminPayment.validation.js';

router.get('/transactions', requirePlatformPermission('platform.payments.view'), paymentController.getAllTransactions);
router.get('/transactions/export', requirePlatformPermission('platform.payments.view'), paymentController.exportTransactions);
router.get('/transactions/:id', requirePlatformPermission('platform.payments.view'), paymentController.getTransactionById);
router.get('/transactions/:id/receipt', requirePlatformPermission('platform.payments.view'), paymentController.downloadTransactionReceipt);
router.get('/payments/reconciliation', requirePlatformPermission('platform.payments.view'), paymentController.getPaymentReconciliation);
router.get('/gateway/status', requirePlatformPermission('platform.payments.view'), paymentController.getGatewayStatus);
router.post('/gateway/configure', requirePlatformPermission('platform.payments.view'), validate(configureGatewaySchema), paymentController.configureGateway);
router.get('/dashboard/stats', requirePlatformPermission('platform.dashboard.view'), paymentController.getDashboardStats);

router.get('/audit-log', requirePlatformPermission('platform.audit.view'), platformAuditLogController.listPlatformAuditLogs);
router.get('/audit-log/export-csv', requirePlatformPermission('platform.audit.view'), platformAuditLogController.exportPlatformAuditLogsCsv);

// RE-05 fix: notification routes now require the same platform permission gate
// used by every other route on this router.
router.get('/notification-preferences', requirePlatformPermission('platform.dashboard.view'), platformNotificationPrefsController.getNotificationPreferences);
router.put('/notification-preferences', requirePlatformPermission('platform.dashboard.view'), platformNotificationPrefsController.updateNotificationPreferences);

router.get('/notifications', requirePlatformPermission('platform.dashboard.view'), platformNotificationController.listPlatformNotifications);
router.get('/notifications/unread-count', requirePlatformPermission('platform.dashboard.view'), platformNotificationController.getUnreadCount);
router.post('/notifications/:id/read', requirePlatformPermission('platform.dashboard.view'), platformNotificationController.markPlatformNotificationRead);
router.post('/notifications/mark-all-read', requirePlatformPermission('platform.dashboard.view'), platformNotificationController.markAllPlatformNotificationsRead);

router.get('/analytics', requirePlatformPermission('platform.dashboard.view'), (req, res) => {
  res.json({ status: 'success', message: 'Platform analytics (scaffold)' });
});

router.get('/smtp-settings', requirePlatformPermission('platform.settings.view', 'platform.settings.manage'), getPlatformSmtpSettings);

// ── Platform Settings ────────────────────────────────────────────────────────
// Identity
router.get('/settings/identity',   requirePlatformPermission('platform.settings.view', 'platform.settings.manage'), platformSettingsController.getIdentitySettings);
router.patch('/settings/identity', requirePlatformPermission('platform.settings.manage'), platformSettingsController.updateIdentitySettings);
router.post('/settings/identity/logo',    requirePlatformPermission('platform.settings.manage'), handlePlatformLogoUpload,    platformSettingsController.uploadPlatformLogo);
router.post('/settings/identity/favicon', requirePlatformPermission('platform.settings.manage'), handlePlatformFaviconUpload, platformSettingsController.uploadPlatformFavicon);

// Connectivity (SMTP + S3)
router.get('/settings/connectivity',            requirePlatformPermission('platform.settings.view', 'platform.settings.manage'), platformSettingsController.getConnectivitySettings);
router.patch('/settings/connectivity',          requirePlatformPermission('platform.settings.manage'), platformSettingsController.updateConnectivitySettings);
router.post('/settings/connectivity/smtp/test', requirePlatformPermission('platform.settings.manage'), platformSettingsController.testSmtpConnection);
router.post('/settings/connectivity/smtp/send-test', requirePlatformPermission('platform.settings.manage'), platformSettingsController.sendSmtpTestEmail);

// Security
router.get('/settings/security',   requirePlatformPermission('platform.settings.view', 'platform.settings.manage'), platformSettingsController.getSecuritySettings);
router.patch('/settings/security', requirePlatformPermission('platform.settings.manage'), platformSettingsController.updateSecuritySettings);

router.get('/modules', requirePlatformPermission('platform.plans.view', 'platform.plans.manage'), moduleController.getAllModules);
router.post('/modules', requirePlatformPermission('platform.plans.manage'), moduleController.createModule);
router.put('/modules/:id', requirePlatformPermission('platform.plans.manage'), moduleController.updateModule);
router.delete('/modules/:id', requirePlatformPermission('platform.plans.manage'), moduleController.deleteModule);
router.get('/plans/:planId/modules', requirePlatformPermission('platform.plans.view', 'platform.plans.manage'), moduleController.getModulesByPlan);
router.put('/plans/:planId/modules', requirePlatformPermission('platform.plans.manage'), moduleController.updatePlanModules);

// ── Superadmin Profile ───────────────────────────────────────────────────────
router.get('/profile',                                    profileController.getSuperadminProfile);
router.patch('/profile',                                  profileController.updateSuperadminProfile);
router.post('/profile/avatar', handleSuperadminAvatarUpload, profileController.uploadSuperadminAvatar);
router.patch('/profile/password',                         profileController.changeSuperadminPassword);
router.post('/profile/2fa/setup',                         profileController.setup2FAForSuperadmin);
router.post('/profile/2fa/verify',                        profileController.verify2FASetupForSuperadmin);
router.post('/profile/2fa/disable',                       profileController.disable2FAForSuperadmin);

export default router;
