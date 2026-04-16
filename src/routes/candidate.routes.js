import { Router } from 'express';
import * as candidateController from '../controllers/AdminControllers/candidate.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { checkRole, checkPermission, ROLES } from '../middlewares/role.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyToken);

// Apply role-based access control - Only Admin can manage candidates
router.use(checkRole([ROLES.ADMIN]));

// CREATE Candidate
router.post("/", checkPermission('admin.candidates.create'), candidateController.createCandidate);

// READ Operations
router.get("/", checkPermission('admin.candidates.view'), candidateController.getAllCandidates);
router.get("/export", checkPermission('admin.candidates.view'), candidateController.exportCandidates);
router.get("/:id", checkPermission('admin.candidates.view'), candidateController.getCandidateById);

// UPDATE Operations
router.put("/:id", checkPermission('admin.candidates.update'), candidateController.updateCandidate);
router.patch("/:id/toggle-status", checkPermission('admin.users.toggle_status'), candidateController.toggleCandidateStatus);
router.patch("/:id/reset-password", checkPermission('admin.users.reset_password'), candidateController.resetCandidatePassword);

// DELETE Operations
router.delete("/:id", checkPermission('admin.candidates.delete'), candidateController.deleteCandidate);

// BULK IMPORT Operations
router.post("/bulk-import", candidateController.uploadMiddleware, checkPermission('admin.candidates.create'), candidateController.bulkImportCandidates);

export default router;
