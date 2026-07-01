import { Router } from 'express';
import { getSponsorAuditLogs, getSponsorAuditActions } from './sponsorAuditLog.controller.js';

const router = Router();

// Mounted at /api/business/audit-logs (auth + BUSINESS role enforced by Sponsor/index.js)
router.get('/actions', getSponsorAuditActions);
router.get('/', getSponsorAuditLogs);

export default router;
