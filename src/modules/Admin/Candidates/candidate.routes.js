import { Router } from 'express';
import * as controller from './candidate.controller.js';
import { validate } from '../../../middlewares/validate.middleware.js';
import * as schema from '../../../validations/candidate.validation.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';
import * as candidateApplicationController from '../../Candidate/Application/candidateApplication.controller.js';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(verifyTokenAndTenant);

// Export/Import routes (must come before :id routes to avoid conflicts)
router.get(
  "/applications/export",
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  candidateApplicationController.exportCandidateApplicationsExcel
);

router.post(
  "/applications/import",
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  upload.single('file'),
  candidateApplicationController.importCandidateApplicationsExcel
);

router.post("/", validate(schema.createCandidateSchema), controller.createCandidate);
router.get("/", controller.getAllCandidates);
router.get("/:id", validate(schema.getCandidateSchema), controller.getCandidateById);
router.patch("/:id", validate(schema.updateCandidateSchema), controller.updateCandidate);
router.patch("/:id/toggle-status", validate(schema.getCandidateSchema), controller.toggleCandidateStatus);
router.delete("/:id", controller.deleteCandidate);
router.post("/:id/reset-password", controller.resetCandidatePassword);
router.get("/:id/application", controller.getCandidateApplication);
router.put("/:id/application", controller.updateCandidateApplication);
router.get(
  "/:id/application-pdf",
  verifyTokenAndTenant,
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  candidateApplicationController.downloadCandidateApplicationPdf,
);

export default router;
