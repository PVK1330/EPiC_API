import { Router } from 'express';
import { verifyToken } from '../../middlewares/auth.middleware.js';
import { requireCandidate } from '../../middlewares/requireCandidate.middleware.js';
import { checkRole, ROLES } from '../../middlewares/role.middleware.js';
import * as candidateApplicationController from '../../controllers/CandidateControllers/candidateApplication.controller.js';

const router = Router();

router.get(
  '/field-settings',
  verifyToken,
  requireCandidate,
  candidateApplicationController.getCandidateApplicationFieldSettings,
);
router.get(
  '/custom-fields',
  verifyToken,
  requireCandidate,
  candidateApplicationController.getCandidateApplicationCustomFields,
);

// ── Candidate-only routes ────────────────────────────────────────────────────
// GET  /api/candidate-application       — fetch the logged-in candidate's saved application
router.get('/', verifyToken, requireCandidate, candidateApplicationController.getMyApplication);

// POST /api/candidate-application       — submit the completed application
router.post('/', verifyToken, requireCandidate, candidateApplicationController.submitApplication);

// PUT  /api/candidate-application       — save progress as a draft
router.put('/', verifyToken, requireCandidate, candidateApplicationController.saveDraft);

router.get(
  '/filled-application-pdf',
  verifyToken,
  requireCandidate,
  candidateApplicationController.downloadFilledApplicationPdf,
);

router.get(
  '/case-summary-pdf',
  verifyToken,
  requireCandidate,
  candidateApplicationController.downloadCaseSummaryPdf,
);

// ── Admin / caseworker routes ────────────────────────────────────────────────
// PATCH /api/candidate-application/:candidateId/unlock — unlock a submitted application
router.patch(
  '/:candidateId/unlock',
  verifyToken,
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  candidateApplicationController.unlockApplication,
);

export default router;
