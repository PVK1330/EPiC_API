import { Router } from 'express';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { requireCandidate } from '../middlewares/requireCandidate.middleware.js';
import * as candidateAccountController from '../controllers/candidateAccount.controller.js';

const router = Router();

router.get('/', verifyToken, requireCandidate, candidateAccountController.getAccount);
router.patch('/preferences', verifyToken, requireCandidate, candidateAccountController.patchPreferences);
router.post('/feedback', verifyToken, requireCandidate, candidateAccountController.postFeedback);
router.post('/consent', verifyToken, requireCandidate, candidateAccountController.postConsent);
router.post('/data-deletion-request', verifyToken, requireCandidate, candidateAccountController.postDataDeletionRequest);

export default router;
