import express from 'express';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { checkPermission } from '../middlewares/role.middleware.js';
import { handleDocumentUpload } from '../middlewares/upload.middleware.js';
import {
  uploadDocuments,
  getUserDocumentsByCategory,
  getCaseDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument,
  updateDocumentStatus,
  downloadDocument
} from '../controllers/document.controller.js';

const router = express.Router();

// Routes
router.post('/upload', 
  verifyToken, 
  checkPermission('document_upload'), 
  handleDocumentUpload, 
  uploadDocuments
);

router.get('/category/:category/user/:userId', 
  verifyToken, 
  checkPermission('document_view'), 
  getUserDocumentsByCategory
);

router.get('/case/:caseId', 
  verifyToken, 
  checkPermission('document_view'), 
  getCaseDocuments
);

router.get('/:documentId', 
  verifyToken, 
  checkPermission('document_view'), 
  getDocumentById
);

router.put('/:documentId', 
  verifyToken, 
  checkPermission('document_update'), 
  updateDocument
);

router.delete('/:documentId', 
  verifyToken, 
  checkPermission('document_delete'), 
  deleteDocument
);

router.patch('/status/:documentId', 
  verifyToken, 
  checkPermission('document_review'), 
  updateDocumentStatus
);

router.get('/download/:documentId', 
  verifyToken, 
  checkPermission('document_download'), 
  downloadDocument
);

export default router;
