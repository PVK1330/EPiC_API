import { Router } from 'express';
import * as rbacController from '../controllers/AdminControllers/rbac.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { checkRole, ROLES } from '../middlewares/role.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyToken);

// Apply role-based access control - Only Admin can review RBAC
router.use(checkRole([ROLES.ADMIN]));

// RBAC Overview and Review
router.get("/overview", rbacController.getRbacOverview);
router.get("/matrix", rbacController.getRbacMatrix);
router.get("/users", rbacController.getUsersWithRolesAndPermissions);

// Permission Audit
router.get("/audit/:permissionId", rbacController.getPermissionAudit);

// Orphan detection
router.get("/orphan-permissions", rbacController.getOrphanPermissions);
router.get("/roles-without-permissions", rbacController.getRolesWithoutPermissions);

// Bulk operations
router.post("/bulk-assign", rbacController.bulkAssignPermissions);

export default router;
