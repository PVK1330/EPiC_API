import { Router } from 'express';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { requireCandidate } from '../../../middlewares/requireCandidate.middleware.js';
import { handleProfilePicUpload, handleCandidateIssueReportUpload } from '../../../middlewares/upload.middleware.js';
import { uploadLimiter } from '../../../middlewares/uploadRateLimiter.js';
import * as candidateAccountController from './candidateAccount.controller.js';

const router = Router();

router.get('/', candidateAccountController.getAccount);
router.put('/profile', handleProfilePicUpload, candidateAccountController.updateProfile);
router.post('/change-password', candidateAccountController.changePassword);
router.patch('/preferences', candidateAccountController.patchPreferences);
router.post('/feedback', candidateAccountController.postFeedback);
// uploadLimiter bounds report spam / notification+email amplification and disk use
// (20 uploads / 10 min per tenant+user+ip).
router.post(
  '/issue-report',
  uploadLimiter,
  handleCandidateIssueReportUpload,
  candidateAccountController.postIssueReport,
);
router.get(
  '/issue-report/:reportId/attachment/:index',
  candidateAccountController.getIssueReportAttachment,
);
router.post('/consent', candidateAccountController.postConsent);
router.post('/data-deletion-request', candidateAccountController.postDataDeletionRequest);

export default router;
