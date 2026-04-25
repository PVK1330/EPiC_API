import { Router } from "express";
import * as caseworkerSponsorController from "../../controllers/CaseworkerControllers/caseworkerSponsor.controller.js";
import { verifyToken } from "../../middlewares/auth.middleware.js";
import { checkRole, ROLES } from "../../middlewares/role.middleware.js";

const router = Router();

// Require authentication for all routes
router.use(verifyToken);

// Require caseworker role for all routes
router.use(checkRole([ROLES.CASEWORKER]));

// Get all sponsors (read-only for caseworkers)
router.get("/", caseworkerSponsorController.getAllSponsors);

// Get sponsor by ID (read-only for caseworkers)
router.get("/:id", caseworkerSponsorController.getSponsorById);

export default router;
