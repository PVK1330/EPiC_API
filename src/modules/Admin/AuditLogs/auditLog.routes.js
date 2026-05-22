import { Router } from 'express';
import * as auditLogController from './auditLog.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.ADMIN]));

// Stats summary — must be before /:id style routes
router.get('/stats',   auditLogController.getAuditStats);
router.get('/actions', auditLogController.getAuditActionTypes);
router.get('/export',  auditLogController.exportAuditLogs);
router.get('/',        auditLogController.getAuditLogs);

export default router;
