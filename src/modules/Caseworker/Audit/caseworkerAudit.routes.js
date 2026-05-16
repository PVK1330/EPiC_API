import express from 'express';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';
import {
  getCaseAuditLogs
} from './caseworkerAudit.controller.js';

const router = express.Router();

// Apply authentication and role-based access
router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.ADMIN, ROLES.CASEWORKER]));

// Routes
router.get('/case/:caseId',
  getCaseAuditLogs
);

export default router;
