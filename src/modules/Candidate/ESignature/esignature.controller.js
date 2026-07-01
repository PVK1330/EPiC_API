/**
 * Week 6: E-signature support — Candidate side.
 *
 * Candidates see pending signature requests, view the document,
 * submit their drawn/typed signature, or decline.
 */
import { randomBytes } from 'crypto';
import { Op } from 'sequelize';
import catchAsync from '../../../utils/catchAsync.js';
import ApiResponse from '../../../utils/apiResponse.js';
import logger from '../../../utils/logger.js';

const TOKEN_EXPIRY_DAYS = 14;

/** GET /api/candidate/esignature — list all requests for this candidate */
export const listSignatureRequests = catchAsync(async (req, res) => {
  const userId = req.user?.userId;
  const tenantDb = req.tenantDb;

  const requests = await tenantDb.EsignatureRequest.findAll({
    where: { signer_id: userId },
    order: [['created_at', 'DESC']],
    attributes: [
      'id', 'title', 'description', 'status', 'expires_at',
      'signed_at', 'declined_at', 'created_at', 'case_id', 'document_id',
    ],
  });

  return ApiResponse.success(res, requests, 'Signature requests retrieved');
});

/** GET /api/candidate/esignature/:id — get request detail + document info */
export const getSignatureRequest = catchAsync(async (req, res) => {
  const userId = req.user?.userId;
  const tenantDb = req.tenantDb;
  const { id } = req.params;

  const request = await tenantDb.EsignatureRequest.findOne({
    where: { id, signer_id: userId },
  });

  if (!request) return ApiResponse.notFound(res, 'Signature request not found');

  if (request.status === 'pending' && new Date() > new Date(request.expires_at)) {
    await request.update({ status: 'expired' });
    request.status = 'expired';
  }

  let documentInfo = null;
  if (request.document_id) {
    const doc = await tenantDb.Document.findByPk(request.document_id, {
      attributes: ['id', 'documentName', 'documentType', 'mimeType', 'fileSize'],
    });
    if (doc) {
      documentInfo = { ...doc.toJSON(), downloadUrl: `/api/documents/${doc.id}/download` };
    }
  }

  return ApiResponse.success(res, { ...request.toJSON(), document: documentInfo });
});

/** POST /api/candidate/esignature/:id/sign — submit signature */
export const submitSignature = catchAsync(async (req, res) => {
  const userId = req.user?.userId;
  const tenantDb = req.tenantDb;
  const { id } = req.params;
  const { signatureData, signatureType = 'drawn' } = req.body;

  if (!signatureData) return ApiResponse.badRequest(res, 'signatureData is required');
  if (!['drawn', 'typed'].includes(signatureType)) {
    return ApiResponse.badRequest(res, 'signatureType must be drawn or typed');
  }
  if (signatureData.length > 500_000) {
    return ApiResponse.badRequest(res, 'Signature data too large');
  }

  const request = await tenantDb.EsignatureRequest.findOne({
    where: { id, signer_id: userId, status: 'pending' },
  });

  if (!request) return ApiResponse.notFound(res, 'Pending signature request not found');

  if (new Date() > new Date(request.expires_at)) {
    await request.update({ status: 'expired' });
    return ApiResponse.badRequest(res, 'Signature request has expired');
  }

  await request.update({
    status: 'signed',
    signature_data: signatureData,
    signature_type: signatureType,
    signed_at: new Date(),
    ip_address: req.ip,
    user_agent: req.headers['user-agent'] || null,
  });

  logger.info({ requestId: id, userId }, 'E-signature submitted');
  return ApiResponse.success(res, { id: request.id, status: 'signed', signed_at: request.signed_at }, 'Document signed successfully');
});

/** POST /api/candidate/esignature/:id/decline — decline signing */
export const declineSignature = catchAsync(async (req, res) => {
  const userId = req.user?.userId;
  const tenantDb = req.tenantDb;
  const { id } = req.params;
  const { reason } = req.body;

  const request = await tenantDb.EsignatureRequest.findOne({
    where: { id, signer_id: userId, status: 'pending' },
  });

  if (!request) return ApiResponse.notFound(res, 'Pending signature request not found');

  await request.update({
    status: 'declined',
    declined_at: new Date(),
    decline_reason: reason || null,
  });

  return ApiResponse.success(res, { id: request.id, status: 'declined' }, 'Signature request declined');
});

// ── Admin side — create + list requests ──────────────────────────────────────

/** POST /api/admin/esignature — create signature request for a candidate */
export const createSignatureRequest = catchAsync(async (req, res) => {
  const tenantDb = req.tenantDb;
  const requestedBy = req.user?.userId;
  const { caseId, documentId, signerId, title, description, expiryDays = TOKEN_EXPIRY_DAYS } = req.body;

  if (!signerId || !title) {
    return ApiResponse.badRequest(res, 'signerId and title are required');
  }

  const token = randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + Math.min(expiryDays, 90) * 24 * 60 * 60 * 1000);

  const request = await tenantDb.EsignatureRequest.create({
    case_id: caseId || null,
    document_id: documentId || null,
    requested_by: requestedBy,
    signer_id: signerId,
    title,
    description: description || null,
    token,
    expires_at: expiresAt,
    status: 'pending',
  });

  return ApiResponse.created(res, {
    id: request.id,
    token,
    expires_at: expiresAt,
    signingUrl: `/candidate/esignature/${request.id}`,
  }, 'Signature request created');
});

/** GET /api/admin/esignature — list all requests (with optional filters) */
export const listAllSignatureRequests = catchAsync(async (req, res) => {
  const tenantDb = req.tenantDb;
  const { status, caseId } = req.query;

  const where = {};
  if (status) where.status = status;
  if (caseId) where.case_id = caseId;

  const requests = await tenantDb.EsignatureRequest.findAll({
    where,
    order: [['created_at', 'DESC']],
  });

  return ApiResponse.success(res, requests);
});
