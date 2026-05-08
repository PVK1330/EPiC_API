import express from 'express';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { isSuperAdmin } from '../middlewares/isSuperAdmin.js';

const router = express.Router();

// All routes here require superadmin privileges
router.use(verifyToken, isSuperAdmin);

// Placeholder controllers (to be implemented)
router.get('/organisations', (req, res) => {
  res.json({ status: 'success', message: 'List all organizations (scaffold)' });
});

router.post('/organisations', (req, res) => {
  res.json({ status: 'success', message: 'Create organization (scaffold)' });
});

router.patch('/organisations/:id', (req, res) => {
  res.json({ status: 'success', message: 'Update organization (scaffold)' });
});

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
