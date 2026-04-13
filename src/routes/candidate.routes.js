import { Router } from 'express';
import * as candidateController from '../controllers/AdminControllers/candidate.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { checkRole, ROLES } from '../middlewares/role.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyToken);

// Apply role-based access control - Only Admin can manage candidates
router.use(checkRole([ROLES.ADMIN]));

// CREATE Candidate
router.post("/", candidateController.createCandidate);

// READ Operations
router.get("/", candidateController.getAllCandidates);
router.get("/:id", candidateController.getCandidateById);

// UPDATE Operations
router.put("/:id", candidateController.updateCandidate);
router.patch("/:id/toggle-status", candidateController.toggleCandidateStatus);
router.patch("/:id/reset-password", candidateController.resetCandidatePassword);

// DELETE Operations
router.delete("/:id", candidateController.deleteCandidate);

export default router;
