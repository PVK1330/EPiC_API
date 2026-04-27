import express from 'express';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { checkPermission, checkAnyPermission } from '../middlewares/role.middleware.js';
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

// Permissions used in this router:
const VIEW_PERMS = ['caseworker.documents.view', 'candidate.documents.view', 'business.compliance.documents', 'admin.cases.detail'];
const UPLOAD_PERMS = ['caseworker.documents.upload', 'candidate.documents.upload', 'business.profile.update', 'admin.cases.update'];
const UPDATE_PERMS = ['caseworker.cases.update', 'admin.cases.update', 'business.profile.update'];
const DELETE_PERMS = ['admin.cases.delete'];
const REVIEW_PERMS = ['caseworker.cases.update', 'admin.cases.update'];
const DOWNLOAD_PERMS = ['caseworker.documents.view', 'candidate.documents.view', 'business.compliance.documents', 'admin.cases.detail'];

// Routes
router.post('/upload', 
  verifyToken, 
  checkAnyPermission(UPLOAD_PERMS), 
  handleDocumentUpload, 
  uploadDocuments
);

router.get('/category/:category/user/:userId', 
  verifyToken, 
  checkAnyPermission(VIEW_PERMS), 
  getUserDocumentsByCategory
);

router.get('/case/:caseId', 
  verifyToken, 
  checkAnyPermission(VIEW_PERMS), 
  getCaseDocuments
);

router.get('/:documentId', 
  verifyToken, 
  checkAnyPermission(VIEW_PERMS), 
  getDocumentById
);

router.put('/:documentId', 
  verifyToken, 
  checkAnyPermission(UPDATE_PERMS), 
  updateDocument
);

router.delete('/:documentId', 
  verifyToken, 
  checkAnyPermission(DELETE_PERMS), 
  deleteDocument
);

router.patch('/status/:documentId', 
  verifyToken, 
  checkAnyPermission(REVIEW_PERMS), 
  updateDocumentStatus
);

router.get('/download/:documentId', 
  verifyToken, 
  checkAnyPermission(DOWNLOAD_PERMS), 
  downloadDocument
);

export default router;
