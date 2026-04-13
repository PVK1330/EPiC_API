import { Router } from 'express';
import * as userController from '../controllers/user.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { ROLES } from '../middlewares/role.middleware.js';

const router = Router();

// Get user profile - accessible for all authenticated users
router.get("/profile", verifyToken, userController.profile);

// Edit user profile - accessible for all authenticated users
router.put("/profile", verifyToken, userController.editProfile);

export default router;