import { Router } from 'express';
import * as crController from './changeRequest.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

router.use(verifyTokenAndTenant);

import { validate } from '../../../middlewares/validate.middleware.js';
import * as schema from '../../../validations/changeRequest.validation.js';

// Candidate / Sponsor
router.post('/', validate(schema.createChangeRequestSchema), crController.createRequest);

// Shared
router.get('/', validate(schema.listChangeRequestsSchema), crController.listRequests);
router.get('/:id', validate(schema.getChangeRequestSchema), crController.getRequestById);
router.get('/history/:id', validate(schema.getChangeRequestSchema), crController.getRequestHistory);

// Admin / Caseworker
router.put('/:id/review', checkRole([ROLES.ADMIN, ROLES.SUPERADMIN, ROLES.CASEWORKER]), validate(schema.reviewActionSchema), crController.reviewRequest);
router.put('/:id/approve', checkRole([ROLES.ADMIN, ROLES.SUPERADMIN, ROLES.CASEWORKER]), validate(schema.reviewActionSchema), crController.approveRequest);
router.put('/:id/reject', checkRole([ROLES.ADMIN, ROLES.SUPERADMIN, ROLES.CASEWORKER]), validate(schema.reviewActionSchema), crController.rejectRequest);
router.put('/:id/escalate', checkRole([ROLES.ADMIN, ROLES.SUPERADMIN, ROLES.CASEWORKER]), validate(schema.reviewActionSchema), crController.escalateRequest);

export default router;
