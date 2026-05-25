import { Router } from 'express';
import {
  getDocumentsBySponsor,
  uploadComplianceDocument,
  updateDocumentMetadata,
  deleteComplianceDocument,
} from './complianceDocument.controller.js';
import { upload } from '../../../middlewares/upload.middleware.js';

const router = Router();

router.get('/', getDocumentsBySponsor);
router.post('/upload', upload.single('file'), uploadComplianceDocument);
router.put('/:id', updateDocumentMetadata);
router.delete('/:id', deleteComplianceDocument);

export default router;
