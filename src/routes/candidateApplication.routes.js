import { Router } from 'express';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { requireCandidate } from '../middlewares/requireCandidate.middleware.js';
import * as candidateApplicationController from '../controllers/candidateApplication.controller.js';

const router = Router();

// All routes require a valid candidate session
router.use(verifyToken, requireCandidate);

// GET  /api/candidate-application       — fetch the logged-in candidate's saved application
router.get('/', candidateApplicationController.getMyApplication);

// POST /api/candidate-application       — submit the completed application
router.post('/', candidateApplicationController.submitApplication);

// PUT  /api/candidate-application       — save progress as a draft
router.put('/', candidateApplicationController.saveDraft);

export default router;
