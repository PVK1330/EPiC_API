import { Router } from 'express';
import * as controller from './candidate.controller.js';
import { validate } from '../../../middlewares/validate.middleware.js';
import * as schema from '../../../validations/candidate.validation.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ensureSelfOrRole, ROLES } from '../../../middlewares/role.middleware.js';
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

// ── Admin / Caseworker only ──────────────────────────────────────────────
// Candidate management is staff-only. Candidates must never list, view, edit,
// delete, or reset the password of any candidate record (including their own
// via these admin endpoints) — that is broken access control / IDOR.
const STAFF = [ROLES.ADMIN, ROLES.CASEWORKER];

router.post("/", checkRole(STAFF), validate(schema.createCandidateSchema), controller.createCandidate);
router.get("/", checkRole(STAFF), controller.getAllCandidates);
router.get("/:id", checkRole(STAFF), validate(schema.getCandidateSchema), controller.getCandidateById);
router.patch("/:id", checkRole(STAFF), validate(schema.updateCandidateSchema), controller.updateCandidate);
router.patch("/:id/toggle-status", checkRole(STAFF), validate(schema.getCandidateSchema), controller.toggleCandidateStatus);
router.patch("/:id/assign-business", checkRole(STAFF), validate(schema.assignCandidateBusinessSchema), controller.assignCandidateBusiness);
router.delete("/:id", checkRole(STAFF), controller.deleteCandidate);
router.post("/:id/reset-password", checkRole(STAFF), validate(schema.resetCandidatePasswordSchema), controller.resetCandidatePassword);

// ── Self-service (candidate) OR staff ────────────────────────────────────
// A candidate may read/update only their OWN application; admins and
// caseworkers may act on any candidate's application.
router.get("/:id/application", ensureSelfOrRole(STAFF), controller.getCandidateApplication);
router.put("/:id/application", ensureSelfOrRole(STAFF), controller.updateCandidateApplication);
router.get(
  "/:id/application-pdf",
  verifyTokenAndTenant,
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  candidateApplicationController.downloadCandidateApplicationPdf,
);

export default router;
