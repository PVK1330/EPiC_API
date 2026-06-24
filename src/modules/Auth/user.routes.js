import { Router } from 'express';
import * as userController from './user.controller.js';
import { verifyTokenAndTenant } from '../../middlewares/authStack.middleware.js';
import { ROLES, checkRole } from '../../middlewares/role.middleware.js';
import { handleProfilePicUpload } from '../../middlewares/upload.middleware.js';

const router = Router();

import { validate } from '../../middlewares/validate.middleware.js';
import * as schema from '../../validations/user.validation.js';

// Get user profile - accessible for all authenticated users
router.get("/profile", verifyTokenAndTenant, userController.profile);

// Change own password - all authenticated users
router.post("/change-password", verifyTokenAndTenant, validate(schema.changeOwnPasswordSchema), userController.changeOwnPassword);

// Edit user profile - accessible for all authenticated users
router.put("/profile", handleProfilePicUpload, verifyTokenAndTenant, validate(schema.editProfileSchema), userController.editProfile);

// Get all users with role-wise grouping - RE-04 fix: restricted to admin/caseworker
router.get("/all", verifyTokenAndTenant, checkRole([ROLES.ADMIN, ROLES.CASEWORKER, ROLES.SUPERADMIN]), userController.getAllUsers);

// Get sponsors dropdown - accessible for all authenticated users
router.get("/sponsors/dropdown", verifyTokenAndTenant, userController.dropdownSponsors);

export default router;
