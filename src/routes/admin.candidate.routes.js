import { Router } from 'express';
import * as candidateController from '../controllers/AdminControllers/candidate.controller.js';
import * as candidateApplicationController from '../controllers/CandidateControllers/candidateApplication.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { checkRole, checkPermission, ROLES } from '../middlewares/role.middleware.js';

const router = Router();

router.use(verifyToken);

router.use(checkRole([ROLES.ADMIN]));

router.post("/", checkPermission('admin.candidates.create'), candidateController.createCandidate);

router.get("/", checkPermission('admin.candidates.view'), candidateController.getAllCandidates);
router.get("/export", checkPermission('admin.candidates.view'), candidateController.exportCandidates);
router.get(
  "/applications/export",
  checkPermission('admin.candidates.view'),
  candidateApplicationController.exportCandidateApplicationsExcel,
);
router.post(
  "/applications/import",
  candidateController.uploadMiddleware,
  checkPermission('admin.candidates.create'),
  candidateApplicationController.importCandidateApplicationsExcel,
);
router.get("/:id", checkPermission('admin.candidates.view'), candidateController.getCandidateById);

router.put("/:id", checkPermission('admin.candidates.update'), candidateController.updateCandidate);
router.put(
  "/:id/application",
  checkPermission('admin.candidates.update'),
  candidateApplicationController.adminUpdateCandidateApplication,
);
router.patch("/:id/toggle-status", checkPermission('admin.users.toggle_status'), candidateController.toggleCandidateStatus);
router.patch("/:id/reset-password", checkPermission('admin.users.reset_password'), candidateController.resetCandidatePassword);

router.delete("/:id", checkPermission('admin.candidates.delete'), candidateController.deleteCandidate);

router.post("/bulk-import", candidateController.uploadMiddleware, checkPermission('admin.candidates.create'), candidateController.bulkImportCandidates);

export default router;
