import { Router } from 'express';
import * as userController from './user.controller.js';
import { verifyTokenAndTenant } from '../../middlewares/authStack.middleware.js';
import { ROLES } from '../../middlewares/role.middleware.js';
import { handleProfilePicUpload } from '../../middlewares/upload.middleware.js';

const router = Router();

// Get user profile - accessible for all authenticated users
router.get("/profile", verifyTokenAndTenant, userController.profile);

// Change own password - all authenticated users
router.post("/change-password", verifyTokenAndTenant, userController.changeOwnPassword);

// Edit user profile - accessible for all authenticated users
router.put("/profile", handleProfilePicUpload, verifyTokenAndTenant, userController.editProfile);

// Get all users with role-wise grouping - accessible for all authenticated users
router.get("/all", verifyTokenAndTenant, userController.getAllUsers);

// Get sponsors dropdown - accessible for all authenticated users
router.get("/sponsors/dropdown", verifyTokenAndTenant, userController.dropdownSponsors);

export default router;
