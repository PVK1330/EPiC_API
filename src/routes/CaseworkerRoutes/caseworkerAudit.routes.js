import express from 'express';
import { verifyToken } from '../../middlewares/auth.middleware.js';
import { checkRole, ROLES } from '../../middlewares/role.middleware.js';
import {
  getCaseAuditLogs
} from '../../controllers/CaseworkerControllers/caseworkerAudit.controller.js';

const router = express.Router();

// Apply authentication and role-based access
router.use(verifyToken);
router.use(checkRole([ROLES.ADMIN, ROLES.CASEWORKER]));

// Routes
router.get('/case/:caseId',
  getCaseAuditLogs
);

export default router;
