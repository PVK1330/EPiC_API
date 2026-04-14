import { Router } from 'express';
import * as caseworkerController from '../controllers/AdminControllers/caseworker.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { checkRole, ROLES } from '../middlewares/role.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyToken);

// Apply role-based access control - Only Admin can manage caseworkers
router.use(checkRole([ROLES.ADMIN]));

// CREATE Caseworker
router.post("/", caseworkerController.createCaseworker);

// READ Operations
router.get("/", caseworkerController.getAllCaseworkers);
router.get("/:id", caseworkerController.getCaseworkerById);

// UPDATE Operations
router.put("/:id", caseworkerController.updateCaseworker);
router.patch("/:id/toggle-status", caseworkerController.toggleCaseworkerStatus);
router.patch("/:id/reset-password", caseworkerController.resetCaseworkerPassword);

// DELETE Operations
router.delete("/:id", caseworkerController.deleteCaseworker);

export default router;
