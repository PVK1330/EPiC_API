import { Router } from 'express';
import * as permissionsController from '../controllers/AdminControllers/permissions.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { checkRole, ROLES } from '../middlewares/role.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyToken);

// Apply role-based access control - Only Admin can manage permissions
router.use(checkRole([ROLES.ADMIN]));

// User permission check - must come before /:id to avoid route conflict
router.get("/check", permissionsController.checkUserPermission);

// Permission CRUD operations
router.get("/", permissionsController.getAllPermissions);
router.post("/", permissionsController.createPermission);
router.get("/:id", permissionsController.getPermissionById);
router.put("/:id", permissionsController.updatePermission);
router.delete("/:id", permissionsController.deletePermission);

export default router;
