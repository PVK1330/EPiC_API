import express from 'express';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { checkRole, ROLES } from '../middlewares/role.middleware.js';
import {
  createChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  getAllChecklists
} from '../Controllers/documentChecklist.controller.js';

const router = express.Router();

// Apply authentication and admin role check
router.use(verifyToken);
router.use(checkRole([ROLES.ADMIN]));

// Routes
router.get('/', getAllChecklists);
router.post('/', createChecklistItem);
router.put('/:id', updateChecklistItem);
router.delete('/:id', deleteChecklistItem);

export default router;
