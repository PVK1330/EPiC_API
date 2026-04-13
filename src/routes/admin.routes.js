import { Router } from 'express';
import * as adminController from '../controllers/AdminControllers/admin.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { checkRole, ROLES } from '../middlewares/role.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyToken);

// Apply role-based access control - Only Admin can manage admins
router.use(checkRole([ROLES.ADMIN]));

// CREATE Admin
router.post("/", adminController.createAdmin);

// READ Operations
router.get("/", adminController.getAllAdmins);
router.get("/:id", adminController.getAdminById);

// UPDATE Operations
router.put("/:id", adminController.updateAdmin);
router.patch("/toggle-status/:id", adminController.toggleAdminStatus);
router.patch("/reset-password/:id", adminController.resetAdminPassword);

// DELETE Operations
router.delete("/:id", adminController.deleteAdmin);

export default router;
