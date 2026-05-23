import { Router } from 'express';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { requireCandidate } from '../../../middlewares/requireCandidate.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';
import * as candidateApplicationController from './candidateApplication.controller.js';

const router = Router();

router.get(
  '/field-settings',
  verifyTokenAndTenant,
  requireCandidate,
  candidateApplicationController.getCandidateApplicationFieldSettings,
);
router.get(
  '/custom-fields',
  verifyTokenAndTenant,
  requireCandidate,
  candidateApplicationController.getCandidateApplicationCustomFields,
);

// ── Candidate-only routes ────────────────────────────────────────────────────
// GET  /api/candidate-application       — fetch the logged-in candidate's saved application
router.get('/', verifyTokenAndTenant, requireCandidate, candidateApplicationController.getMyApplication);

// POST /api/candidate-application       — submit the completed application
router.post('/', verifyTokenAndTenant, requireCandidate, candidateApplicationController.submitApplication);

// PUT  /api/candidate-application       — save progress as a draft
router.put('/', verifyTokenAndTenant, requireCandidate, candidateApplicationController.saveDraft);

router.get(
  '/filled-application-pdf',
  verifyTokenAndTenant,
  requireCandidate,
  candidateApplicationController.downloadFilledApplicationPdf,
);

router.get(
  '/case-summary-pdf',
  verifyTokenAndTenant,
  requireCandidate,
  candidateApplicationController.downloadCaseSummaryPdf,
);

// ── Admin / caseworker routes ────────────────────────────────────────────────
// PATCH /api/candidate-application/:candidateId/unlock — unlock a submitted application
router.patch(
  '/:candidateId/unlock',
  verifyTokenAndTenant,
  checkRole([ROLES.ADMIN, ROLES.CASEWORKER]),
  candidateApplicationController.unlockApplication,
);

export default router;
