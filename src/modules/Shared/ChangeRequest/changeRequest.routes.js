import { Router } from 'express';
import * as crController from './changeRequest.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

router.use(verifyTokenAndTenant);

// Candidate / Sponsor
router.post('/', crController.createRequest);

// Shared
router.get('/', crController.listRequests);
router.get('/:id', crController.getRequestById);
router.get('/history/:id', crController.getRequestHistory);

// Admin / Caseworker
router.put('/:id/review', checkRole([ROLES.ADMIN, ROLES.SUPERADMIN, ROLES.CASEWORKER]), crController.reviewRequest);
router.put('/:id/approve', checkRole([ROLES.ADMIN, ROLES.SUPERADMIN, ROLES.CASEWORKER]), crController.approveRequest);
router.put('/:id/reject', checkRole([ROLES.ADMIN, ROLES.SUPERADMIN, ROLES.CASEWORKER]), crController.rejectRequest);
router.put('/:id/escalate', checkRole([ROLES.ADMIN, ROLES.SUPERADMIN, ROLES.CASEWORKER]), crController.escalateRequest);

export default router;
