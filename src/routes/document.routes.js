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
  checkPermission('caseworker.documents.upload'), 
  handleDocumentUpload, 
  uploadDocuments
);

router.get('/category/:category/user/:userId', 
  verifyToken, 
  checkPermission('caseworker.documents.view'), 
  getUserDocumentsByCategory
);

router.get('/case/:caseId', 
  verifyToken, 
  checkPermission('caseworker.documents.view'), 
  getCaseDocuments
);

router.get('/:documentId', 
  verifyToken, 
  checkPermission('caseworker.documents.view'), 
  getDocumentById
);

router.put('/:documentId', 
  verifyToken, 
  checkPermission('caseworker.documents.view'), 
  updateDocument
);

router.delete('/:documentId', 
  verifyToken, 
  checkPermission('caseworker.documents.view'), 
  deleteDocument
);

router.patch('/status/:documentId', 
  verifyToken, 
  checkPermission('caseworker.documents.view'), 
  updateDocumentStatus
);

router.get('/download/:documentId', 
  verifyToken, 
  checkPermission('caseworker.documents.view'), 
  downloadDocument
);

export default router;
