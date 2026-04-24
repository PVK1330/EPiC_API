import express from 'express';
import { verifyToken } from '../../middlewares/auth.middleware.js';
import { checkRole, ROLES } from '../../middlewares/role.middleware.js';
import { handleDocumentUpload } from '../../middlewares/upload.middleware.js';
import {
  uploadDocuments,
  getCaseDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument,
  updateDocumentStatus,
  downloadDocument
} from '../../controllers/document.controller.js';

const router = express.Router();

// Apply authentication and role-based access
router.use(verifyToken);
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

export default router;
