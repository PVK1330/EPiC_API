import { Router } from 'express';
import { verifyToken } from '../../middlewares/auth.middleware.js';
import { requireCandidate } from '../../middlewares/requireCandidate.middleware.js';
import { handleProfilePicUpload, handleCandidateIssueReportUpload } from '../../middlewares/upload.middleware.js';
import * as candidateAccountController from '../../controllers/CandidateControllers/candidateAccount.controller.js';

const router = Router();

router.get('/', candidateAccountController.getAccount);
router.put('/profile', handleProfilePicUpload, candidateAccountController.updateProfile);
router.post('/change-password', candidateAccountController.changePassword);
router.patch('/preferences', candidateAccountController.patchPreferences);
router.post('/feedback', candidateAccountController.postFeedback);
router.post(
  '/issue-report',
  handleCandidateIssueReportUpload,
  candidateAccountController.postIssueReport,
);
router.post('/consent', candidateAccountController.postConsent);
router.post('/data-deletion-request', candidateAccountController.postDataDeletionRequest);

export default router;
