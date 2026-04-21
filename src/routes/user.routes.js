import { Router } from 'express';
import * as userController from '../controllers/user.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { ROLES } from '../middlewares/role.middleware.js';
import { handleProfilePicUpload } from '../middlewares/upload.middleware.js';

const router = Router();

// Get user profile - accessible for all authenticated users
router.get("/profile", verifyToken, userController.profile);

// Change own password - all authenticated users
router.post("/change-password", verifyToken, userController.changeOwnPassword);

// Edit user profile - accessible for all authenticated users
router.put("/profile", handleProfilePicUpload, verifyToken, userController.editProfile);

// Get all users with role-wise grouping - accessible for all authenticated users
router.get("/all", verifyToken, userController.getAllUsers);

export default router;