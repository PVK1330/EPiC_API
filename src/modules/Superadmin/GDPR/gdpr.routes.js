import { Router } from 'express';
import { exportOrgData, deleteOrgData } from './gdpr.controller.js';

const router = Router();

router.get('/:orgId/export', exportOrgData);
router.delete('/:orgId', deleteOrgData);

export default router;
