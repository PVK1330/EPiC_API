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

const router = express.Router();

router.use(verifyToken, isPlatformStaff);

router.get('/team/modules', teamController.listPlatformModules);
router.get('/team', teamController.listTeamMembers);
router.post('/team', requirePlatformPermission('platform.team.manage'), teamController.inviteTeamMember);
router.patch('/team/:id', requirePlatformPermission('platform.team.manage'), teamController.updateTeamMember);

router.get('/platform-roles', teamController.listPlatformRoles);
router.post('/platform-roles', requirePlatformPermission('platform.team.manage'), teamController.createPlatformRole);
router.patch('/platform-roles/:id', requirePlatformPermission('platform.team.manage'), teamController.updatePlatformRole);
router.delete('/platform-roles/:id', requirePlatformPermission('platform.team.manage'), teamController.deletePlatformRole);

router.post('/announcements', announcementController.createPlatformAnnouncement);

router.get('/organisations', orgController.listOrganisations);
router.get('/organisations/:id', orgController.getOrganisationById);
router.post('/organisations', orgController.createOrganisation);
router.post('/organisations/with-admin', orgController.createOrganisationWithAdmin);
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

router.get('/audit-log', platformAuditLogController.listPlatformAuditLogs);
router.get('/audit-log/export-csv', platformAuditLogController.exportPlatformAuditLogsCsv);

router.get('/notifications', platformNotificationController.listPlatformNotifications);
router.post('/notifications/:id/read', platformNotificationController.markPlatformNotificationRead);
router.post('/notifications/mark-all-read', platformNotificationController.markAllPlatformNotificationsRead);

router.get('/analytics', (req, res) => {
  res.json({ status: 'success', message: 'Platform analytics (scaffold)' });
});

router.get('/smtp-settings', getPlatformSmtpSettings);

// ── Platform Settings ────────────────────────────────────────────────────────
// Identity
router.get('/settings/identity',   platformSettingsController.getIdentitySettings);
router.patch('/settings/identity', platformSettingsController.updateIdentitySettings);
router.post('/settings/identity/logo',    handlePlatformLogoUpload,    platformSettingsController.uploadPlatformLogo);
router.post('/settings/identity/favicon', handlePlatformFaviconUpload, platformSettingsController.uploadPlatformFavicon);

// Connectivity (SMTP + S3)
router.get('/settings/connectivity',            platformSettingsController.getConnectivitySettings);
router.patch('/settings/connectivity',          platformSettingsController.updateConnectivitySettings);
router.post('/settings/connectivity/smtp/test', platformSettingsController.testSmtpConnection);
router.post('/settings/connectivity/smtp/send-test', platformSettingsController.sendSmtpTestEmail);

// Security
router.get('/settings/security',   platformSettingsController.getSecuritySettings);
router.patch('/settings/security', platformSettingsController.updateSecuritySettings);

router.get('/modules', moduleController.getAllModules);
router.post('/modules', moduleController.createModule);
router.put('/modules/:id', moduleController.updateModule);
router.delete('/modules/:id', moduleController.deleteModule);
router.get('/plans/:planId/modules', moduleController.getModulesByPlan);
router.put('/plans/:planId/modules', moduleController.updatePlanModules);

// ── Superadmin Profile ───────────────────────────────────────────────────────
router.get('/profile',                                    profileController.getSuperadminProfile);
router.patch('/profile',                                  profileController.updateSuperadminProfile);
router.post('/profile/avatar', handleSuperadminAvatarUpload, profileController.uploadSuperadminAvatar);
router.patch('/profile/password',                         profileController.changeSuperadminPassword);
router.post('/profile/2fa/setup',                         profileController.setup2FAForSuperadmin);
router.post('/profile/2fa/verify',                        profileController.verify2FASetupForSuperadmin);
router.post('/profile/2fa/disable',                       profileController.disable2FAForSuperadmin);

export default router;
