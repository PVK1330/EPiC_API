import express from 'express';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkAnyPermission } from '../../../middlewares/role.middleware.js';
import { handleDocumentUpload } from '../../../middlewares/upload.middleware.js';
import {
  uploadDocuments,
  getUserDocumentsByCategory,
  getCaseDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument,
  updateDocumentStatus,
  downloadDocument,
  downloadMyDocumentsBundle,
} from './document.controller.js';
import { getChecklistByVisaType } from '../../Admin/Settings/documentChecklist.controller.js';

const router = express.Router();

// Permissions used in this router:
// Candidates have: candidate.documents.view + candidate.documents.upload
// Caseworkers have: caseworker.documents.view + caseworker.documents.upload
const VIEW_PERMS   = ['caseworker.documents.view', 'candidate.documents.view', 'business.compliance.documents', 'admin.cases.detail'];
const UPLOAD_PERMS = ['caseworker.documents.upload', 'candidate.documents.upload', 'business.profile.update', 'admin.cases.update'];
const UPDATE_PERMS = ['caseworker.cases.update', 'admin.cases.update', 'business.profile.update'];
const DELETE_PERMS = ['admin.cases.delete'];
const REVIEW_PERMS = ['caseworker.cases.update', 'admin.cases.update'];
const DOWNLOAD_PERMS = ['caseworker.documents.view', 'candidate.documents.view', 'business.compliance.documents', 'admin.cases.detail'];

// ── Upload ────────────────────────────────────────────────────────────────────
// Only checkAnyPermission — candidates have candidate.documents.upload so they pass.
// The old double-middleware (checkAnyPermission + checkPermission('caseworker…')) was
// an AND-gate that silently blocked all candidate uploads.
router.post('/upload',
  verifyTokenAndTenant,
  checkAnyPermission(UPLOAD_PERMS),
  handleDocumentUpload,
  uploadDocuments
);

// ── Read ──────────────────────────────────────────────────────────────────────
router.get('/category/:category/user/:userId',
  verifyTokenAndTenant,
  checkAnyPermission(VIEW_PERMS),
  getUserDocumentsByCategory
);

router.get('/case/:caseId',
  verifyTokenAndTenant,
  checkAnyPermission(VIEW_PERMS),
  getCaseDocuments
);

router.get('/download/:documentId',
  verifyTokenAndTenant,
  checkAnyPermission(DOWNLOAD_PERMS),
  downloadDocument
);

router.get('/bundle/me',
  verifyTokenAndTenant,
  checkAnyPermission(DOWNLOAD_PERMS),
  downloadMyDocumentsBundle
);

router.get('/checklist/visa/:visaTypeId',
  verifyTokenAndTenant,
  checkAnyPermission(VIEW_PERMS),
  getChecklistByVisaType
);

router.get('/:documentId',
  verifyTokenAndTenant,
  checkAnyPermission(VIEW_PERMS),
  getDocumentById
);

// ── Update ────────────────────────────────────────────────────────────────────
router.put('/:documentId',
  verifyTokenAndTenant,
  checkAnyPermission(UPDATE_PERMS),
  updateDocument
);

router.patch('/status/:documentId',
  verifyTokenAndTenant,
  checkAnyPermission(REVIEW_PERMS),
  updateDocumentStatus
);

// ── Delete ────────────────────────────────────────────────────────────────────
router.delete('/:documentId',
  verifyTokenAndTenant,
  checkAnyPermission(DELETE_PERMS),
  deleteDocument
);

export default router;
