import { Router } from 'express';
import * as auditLogController from './auditLog.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES, requirePlanModule } from '../../../middlewares/role.middleware.js';

const router = Router();

router.use(verifyTokenAndTenant);

// Allow any authenticated user to log their own client events (e.g., session timeout)
router.post('/client-event', auditLogController.logClientEvent);

router.use(checkRole([ROLES.ADMIN]));
router.use(requirePlanModule('admin.audit-logs'));

// Stats summary — must be before /:id style routes
router.get('/stats',   auditLogController.getAuditStats);
router.get('/actions', auditLogController.getAuditActionTypes);
router.get('/export',  auditLogController.exportAuditLogs);
router.get('/',        auditLogController.getAuditLogs);

export default router;
