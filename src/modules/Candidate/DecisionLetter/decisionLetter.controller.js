/**
 * Week 6: UKVI Decision Letter access page.
 *
 * Candidates can view + download their UKVI Decision Letter documents.
 * Admin/Caseworker can upload decision letters tagged as 'UKVI Decision Letter'.
 */
import { Op } from 'sequelize';
import catchAsync from '../../../utils/catchAsync.js';
import ApiResponse from '../../../utils/apiResponse.js';
import logger from '../../../utils/logger.js';

const DECISION_LETTER_TYPES = ['UKVI Decision Letter', 'Decision Letter', 'ukvi_decision_letter'];

/**
 * GET /api/candidate/decision-letter
 * Returns all UKVI Decision Letter documents for the authenticated candidate.
 */
export const getCandidateDecisionLetters = catchAsync(async (req, res) => {
  const userId = req.user?.userId;
  const tenantDb = req.tenantDb;

  const cases = await tenantDb.Case.findAll({
    where: { candidateId: userId },
    attributes: ['id', 'caseId', 'status', 'decisionDate'],
  });

  if (!cases.length) {
    return ApiResponse.success(res, [], 'No cases found');
  }

  const caseIds = cases.map((c) => c.id);
  const caseMap = Object.fromEntries(cases.map((c) => [c.id, c]));

  const documents = await tenantDb.Document.findAll({
    where: {
      caseId: { [Op.in]: caseIds },
      documentType: { [Op.in]: DECISION_LETTER_TYPES },
    },
    attributes: [
      'id', 'caseId', 'documentType', 'documentName', 'documentPath',
      'mimeType', 'fileSize', 'status', 'uploadedAt', 'created_at',
    ],
    order: [['created_at', 'DESC']],
  });

  const result = documents.map((doc) => ({
    id: doc.id,
    documentName: doc.documentName,
    documentType: doc.documentType,
    mimeType: doc.mimeType,
    fileSize: doc.fileSize,
    status: doc.status,
    uploadedAt: doc.uploadedAt || doc.created_at,
    downloadUrl: `/api/documents/${doc.id}/download`,
    case: caseMap[doc.caseId]
      ? {
          id: caseMap[doc.caseId].id,
          caseId: caseMap[doc.caseId].caseId,
          status: caseMap[doc.caseId].status,
          decisionDate: caseMap[doc.caseId].decisionDate,
        }
      : null,
  }));

  return ApiResponse.success(res, result, 'Decision letters retrieved successfully');
});

/**
 * GET /api/candidate/decision-letter/status
 * Returns decision status summary for candidate's cases.
 */
export const getDecisionStatus = catchAsync(async (req, res) => {
  const userId = req.user?.userId;
  const tenantDb = req.tenantDb;

  const cases = await tenantDb.Case.findAll({
    where: { candidateId: userId },
    attributes: ['id', 'caseId', 'status', 'decisionDate', 'closed_at', 'visaTypeId'],
    include: [
      {
        model: tenantDb.VisaType,
        as: 'visaType',
        attributes: ['id', 'name'],
        required: false,
      },
    ],
  });

  const result = cases.map((c) => ({
    caseId: c.caseId,
    status: c.status,
    decisionDate: c.decisionDate,
    visaType: c.visaType?.name || null,
    hasDecision: ['Approved', 'Rejected', 'Closed', 'Decision'].includes(c.status),
    approvalStatus: c.status === 'Approved' ? 'approved' : c.status === 'Rejected' ? 'rejected' : 'pending',
  }));

  return ApiResponse.success(res, result, 'Decision status retrieved');
});
