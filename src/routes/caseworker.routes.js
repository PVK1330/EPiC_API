import { Router } from 'express';
import * as caseworkerController from '../controllers/AdminControllers/caseworker.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { checkRole, checkPermission, ROLES } from '../middlewares/role.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyToken);

// Apply role-based access control - Only Admin can manage caseworkers
router.use(checkRole([ROLES.ADMIN]));

// CREATE Caseworker
router.post("/", checkPermission('admin.caseworkers.create'), caseworkerController.createCaseworker);

// READ Operations
router.get("/", checkPermission('admin.caseworkers.view'), caseworkerController.getAllCaseworkers);
router.get("/:id", checkPermission('admin.caseworkers.view'), caseworkerController.getCaseworkerById);

// UPDATE Operations
router.put("/:id", checkPermission('admin.caseworkers.update'), caseworkerController.updateCaseworker);
router.patch("/:id/toggle-status", checkPermission('admin.users.toggle_status'), caseworkerController.toggleCaseworkerStatus);
router.patch("/:id/reset-password", checkPermission('admin.users.reset_password'), caseworkerController.resetCaseworkerPassword);

// DELETE Operations
router.delete("/:id", checkPermission('admin.caseworkers.delete'), caseworkerController.deleteCaseworker);

export default router;
