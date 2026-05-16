import express from 'express';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';
import { handleDocumentUpload } from '../../../middlewares/upload.middleware.js';
import {
  uploadDocuments,
  getCaseDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument,
  updateDocumentStatus,
  downloadDocument
} from '../../Shared/Documents/document.controller.js';
import {
  getCaseChecklist,
  getChecklistByVisaType
} from '../../Admin/Settings/documentChecklist.controller.js';

const router = express.Router();

// Apply authentication and role-based access
router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.ADMIN, ROLES.CASEWORKER]));

// Routes
router.post('/upload',
  handleDocumentUpload,
  uploadDocuments
);

router.get('/case/:caseId',
  getCaseDocuments
);

router.get('/download/:documentId',
  downloadDocument
);

router.get('/:documentId',
  getDocumentById
);

router.put('/:documentId',
  updateDocument
);

router.delete('/:documentId',
  deleteDocument
);

router.patch('/status/:documentId',
  updateDocumentStatus
);

// Document Checklist routes
router.get('/checklist/case/:caseId',
  getCaseChecklist
);

router.get('/checklist/visa/:visaTypeId',
  getChecklistByVisaType
);

export default router;
