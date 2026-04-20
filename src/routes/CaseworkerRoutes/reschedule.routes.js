import { Router } from 'express';
import * as rescheduleController from '../../controllers/CaseworkerControllers/reschedule.controller.js';
import { verifyToken } from '../../middlewares/auth.middleware.js';
import { checkRole, ROLES } from '../../middlewares/role.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyToken);

// Apply role-based access control - Caseworker only
router.use(checkRole([ROLES.CASEWORKER]));

// Reschedule case by ID
router.patch('/:id', rescheduleController.rescheduleCase);

// Get reschedule history for a case
router.get('/:id/history', rescheduleController.getRescheduleHistory);

export default router;
