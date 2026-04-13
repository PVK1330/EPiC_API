import { Router } from 'express';
import * as sponsorsController from '../controllers/AdminControllers/sponsors.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { checkRole, ROLES } from '../middlewares/role.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyToken);

// Apply role-based access control - Only Admin can manage sponsors
router.use(checkRole([ROLES.ADMIN]));

// CREATE Sponsor
router.post("/", sponsorsController.createSponsor);

// READ Operations
router.get("/", sponsorsController.getAllSponsors);
router.get("/:id", sponsorsController.getSponsorById);

// UPDATE Operations
router.put("/:id", sponsorsController.updateSponsor);
router.patch("/:id/toggle-status", sponsorsController.toggleSponsorStatus);
router.patch("/:id/reset-password", sponsorsController.resetSponsorPassword);

// DELETE Operations
router.delete("/:id", sponsorsController.deleteSponsor);

export default router;
