import express from 'express';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { isSuperAdmin } from '../middlewares/isSuperAdmin.js';
import * as orgController from '../controllers/superadminOrganisation.controller.js';

const router = express.Router();

router.use(verifyToken, isSuperAdmin);

router.get('/organisations', orgController.listOrganisations);
router.post('/organisations', orgController.createOrganisation);
router.patch('/organisations/:id', orgController.updateOrganisation);
router.post('/organisations/:id/admins', orgController.createOrganisationAdmin);

router.get('/audit-log', (req, res) => {
  res.json({ status: 'success', message: 'Global audit log (scaffold)' });
});

router.get('/analytics', (req, res) => {
  res.json({ status: 'success', message: 'Platform analytics (scaffold)' });
});

router.get('/billing', (req, res) => {
  res.json({ status: 'success', message: 'Platform billing (scaffold)' });
});

export default router;
