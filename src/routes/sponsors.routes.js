import { Router } from 'express';
import * as sponsorsController from '../controllers/AdminControllers/sponsors.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { checkRole, checkPermission, ROLES } from '../middlewares/role.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyToken);

// Apply role-based access control - Only Admin can manage sponsors
router.use(checkRole([ROLES.ADMIN]));

// CREATE Sponsor
router.post("/", checkPermission('admin.sponsors.create'), sponsorsController.createSponsor);

// READ Operations
router.get("/", checkPermission('admin.sponsors.view'), sponsorsController.getAllSponsors);
router.get("/export", checkPermission('admin.sponsors.view'), sponsorsController.exportSponsors);
router.get("/:id", checkPermission('admin.sponsors.view'), sponsorsController.getSponsorById);

// UPDATE Operations
router.put("/:id", checkPermission('admin.sponsors.update'), sponsorsController.updateSponsor);
router.patch("/:id/toggle-status", checkPermission('admin.users.toggle_status'), sponsorsController.toggleSponsorStatus);
router.patch("/:id/reset-password", checkPermission('admin.users.reset_password'), sponsorsController.resetSponsorPassword);

// DELETE Operations
router.delete("/:id", checkPermission('admin.sponsors.delete'), sponsorsController.deleteSponsor);

export default router;
