import { Router } from 'express';
import * as sponsorsController from '../../Admin/Sponsors/sponsors.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, checkPermission, ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

import { validate } from '../../../middlewares/validate.middleware.js';
import * as schema from '../../../validations/sponsor.validation.js';

// Apply authentication middleware to all routes
router.use(verifyTokenAndTenant);

// Apply role-based access control - Only Admin can manage sponsors
router.use(checkRole([ROLES.ADMIN]));

// CREATE Sponsor
router.post("/", checkPermission('admin.sponsors.create'), validate(schema.createSponsorSchema), sponsorsController.createSponsor);

// READ Operations
router.get("/", checkPermission('admin.sponsors.view'), sponsorsController.getAllSponsors);
router.get("/export", checkPermission('admin.sponsors.view'), sponsorsController.exportSponsors);
router.get("/:id", checkPermission('admin.sponsors.view'), validate(schema.getSponsorSchema), sponsorsController.getSponsorById);

// UPDATE Operations
router.put("/:id", checkPermission('admin.sponsors.update'), validate(schema.updateSponsorSchema), sponsorsController.updateSponsor);
router.patch("/:id/toggle-status", checkPermission('admin.users.toggle_status'), validate(schema.getSponsorSchema), sponsorsController.toggleSponsorStatus);
router.patch("/:id/reset-password", checkPermission('admin.users.reset_password'), validate(schema.resetSponsorPasswordSchema), sponsorsController.resetSponsorPassword);

// DELETE Operations
router.delete("/:id", checkPermission('admin.sponsors.delete'), validate(schema.getSponsorSchema), sponsorsController.deleteSponsor);

// BULK IMPORT Operations
router.post("/bulk-import", sponsorsController.uploadMiddleware, checkPermission('admin.sponsors.create'), sponsorsController.bulkImportSponsors);

export default router;
