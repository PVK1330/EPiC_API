import { Router } from 'express';
import {
  getDocumentsBySponsor,
  uploadComplianceDocument,
  updateDocumentMetadata,
  deleteComplianceDocument,
  downloadComplianceDocument,
} from './complianceDocument.controller.js';
import { upload } from '../../../middlewares/upload.middleware.js';
import { validate } from '../../../middlewares/validate.middleware.js';
import {
  createComplianceDocumentSchema,
  updateComplianceDocumentSchema,
} from '../../../validations/complianceDocument.validation.js';

const router = Router();

// Mounted under /api/business/compliance-documents — the parent router already
// enforces authentication + BUSINESS (sponsor) role. Sponsors can create and
// edit document details only; status/review fields are reviewer-controlled and
// are rejected by the validation schemas below.
router.get('/', getDocumentsBySponsor);
router.get('/:id/download', downloadComplianceDocument);
router.post(
  '/upload',
  upload.single('file'),
  validate(createComplianceDocumentSchema, 'createComplianceDocument'),
  uploadComplianceDocument
);
router.put(
  '/:id',
  upload.single('file'),
  validate(updateComplianceDocumentSchema, 'updateComplianceDocument'),
  updateDocumentMetadata
);
router.delete('/:id', deleteComplianceDocument);

export default router;
