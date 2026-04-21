import { Router } from 'express';
import * as roleController from '../controllers/AdminControllers/role.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { checkRole, ROLES } from '../middlewares/role.middleware.js';

const router = Router();

router.use(verifyToken);
router.use(checkRole([ROLES.ADMIN]));

// CREATE Role
router.post("/", roleController.createRole);

// READ Operations
router.get("/", roleController.getAllRoles);
router.get("/:id", roleController.getRoleById);
router.get("/:id/permissions", roleController.getRolePermissions);
router.get("/:id/with-permissions", roleController.getRoleWithPermissions);

// UPDATE Operations
router.put("/:id", roleController.updateRole);

// DELETE Operations
router.delete("/:id", roleController.deleteRole);

// Permission Assignment
router.post("/:id/permissions", roleController.assignPermissionsToRole);
router.delete("/:id/permissions/:permissionId", roleController.removePermissionFromRole);

// Clone Permissions
router.post("/clone-permissions", roleController.cloneRolePermissions);

// Update user role
router.patch("/users/:userId/role", roleController.updateUserRole);

export default router;
