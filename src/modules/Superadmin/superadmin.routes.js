import express from 'express';
import { verifyToken } from '../../middlewares/auth.middleware.js';
import { isPlatformStaff, requirePlatformPermission } from '../../middlewares/isPlatformStaff.js';
import * as teamController from './superadminTeam.controller.js';
import * as orgController from './superadminOrganisation.controller.js';
import * as planController from './plan.controller.js';
import { getPlatformSmtpSettings } from '../Admin/Settings/smtp.settings.controller.js';

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

router.get('/organisations', orgController.listOrganisations);
router.get('/organisations/:id', orgController.getOrganisationById);
router.post('/organisations', orgController.createOrganisation);
router.patch('/organisations/:id', orgController.updateOrganisation);
router.delete('/organisations/:id', orgController.deleteOrganisation);
router.post('/organisations/:id/suspend', orgController.suspendOrganisation);
router.post('/organisations/:id/activate', orgController.activateOrganisation);
router.post('/organisations/:id/admins', orgController.createOrganisationAdmin);
router.post('/organisations/:id/impersonate', orgController.impersonateOrganisationAdmin);

// Subscription Plans
router.get('/plans', planController.getAllPlans);
router.get('/plans/:id', planController.getPlanById);
router.post('/plans', planController.createPlan);
router.put('/plans/:id', planController.updatePlan);
router.delete('/plans/:id', planController.deletePlan);

router.get('/audit-log', (req, res) => {
  res.json({ status: 'success', message: 'Global audit log (scaffold)' });
});

router.get('/analytics', (req, res) => {
  res.json({ status: 'success', message: 'Platform analytics (scaffold)' });
});

router.get('/billing', (req, res) => {
  res.json({ status: 'success', message: 'Platform billing (scaffold)' });
});

router.get('/smtp-settings', getPlatformSmtpSettings);

export default router;
