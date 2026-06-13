import { Router } from 'express';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';
import { validate } from '../../../middlewares/validate.middleware.js';
import {
  listComplianceDocumentsForReview,
  getComplianceDocumentForReview,
  startComplianceReview,
  approveComplianceDocument,
  rejectComplianceDocument,
  requestComplianceInformation,
} from './complianceReview.controller.js';
import {
  startReviewComplianceSchema,
  approveComplianceSchema,
  rejectComplianceSchema,
  requestInfoComplianceSchema,
} from '../../../validations/complianceDocument.validation.js';

const router = Router();

// Compliance review surface — Admin and Caseworker only. Sponsors (BUSINESS)
// reach their own documents via /api/business/compliance-documents and can
// never call these review endpoints.
router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.ADMIN, ROLES.CASEWORKER]));

router.get('/', listComplianceDocumentsForReview);
router.get('/:id', getComplianceDocumentForReview);

router.patch('/:id/review', validate(startReviewComplianceSchema, 'startReviewCompliance'), startComplianceReview);
router.patch('/:id/approve', validate(approveComplianceSchema, 'approveCompliance'), approveComplianceDocument);
router.patch('/:id/reject', validate(rejectComplianceSchema, 'rejectCompliance'), rejectComplianceDocument);
router.patch('/:id/request-info', validate(requestInfoComplianceSchema, 'requestInfoCompliance'), requestComplianceInformation);

export default router;
