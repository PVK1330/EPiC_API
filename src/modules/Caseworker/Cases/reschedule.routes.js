import { Router } from 'express';
import * as rescheduleController from './reschedule.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyTokenAndTenant);

// Apply role-based access control - Caseworker only
router.use(checkRole([ROLES.CASEWORKER]));

// Reschedule case by ID
router.patch('/:id', rescheduleController.rescheduleCase);

// Get reschedule history for a case
router.get('/:id/history', rescheduleController.getRescheduleHistory);

// Get all reschedule history
router.get('/', rescheduleController.getAllRescheduleHistory);

export default router;
