import { Router } from 'express';
import * as adminController from '../admin.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, checkPermission, ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyTokenAndTenant);

// Apply role-based access control - Only Admin can manage admins
router.use(checkRole([ROLES.ADMIN]));

// CREATE Admin
router.post("/", checkPermission('admin.admin_users.create'), adminController.createAdmin);

// READ Operations
router.get("/", checkPermission('admin.admin_users.view'), adminController.getAllAdmins);
router.get("/export", checkPermission('admin.admin_users.view'), adminController.exportAdmins);
router.get("/:id", checkPermission('admin.admin_users.view'), adminController.getAdminById);

// UPDATE Operations
router.put("/:id", checkPermission('admin.admin_users.update'), adminController.updateAdmin);
router.patch("/toggle-status/:id", checkPermission('admin.users.toggle_status'), adminController.toggleAdminStatus);
router.patch("/reset-password/:id", checkPermission('admin.users.reset_password'), adminController.resetAdminPassword);

// DELETE Operations
router.delete("/:id", checkPermission('admin.admin_users.delete'), adminController.deleteAdmin);

export default router;
