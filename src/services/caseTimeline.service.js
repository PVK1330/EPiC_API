import db from "../models/index.js";

const { CaseTimeline } = db;

/**
 * Records a timeline entry for a case
 * 
 * @param {Object} params
 * @param {number} params.caseId - The case ID
 * @param {string} params.actionType - Type of action (e.g., 'status_changed', 'document_uploaded')
 * @param {string} params.description - Description of the action
 * @param {number|null} params.performedBy - User ID who performed the action
 * @param {string|null} params.previousValue - Previous value before change
 * @param {string|null} params.newValue - New value after change
 * @param {Object|null} params.metadata - Additional metadata
 * @param {boolean} params.isSystemAction - Whether this is a system action
 * @param {string} params.visibility - Visibility level ('public', 'internal', 'admin_only')
 */
export const recordTimelineEntry = async ({
  caseId,
  actionType,
  description,
  performedBy,
  previousValue = null,
  newValue = null,
  metadata = null,
  isSystemAction = false,
  visibility = 'public',
}) => {
  try {
    await CaseTimeline.create({
      caseId,
      actionType,
      description,
      performedBy,
      previousValue,
      newValue,
      metadata,
      isSystemAction,
      visibility,
    });
  } catch (error) {
    console.error("Failed to record timeline entry:", error);
    // Don't throw to avoid crashing main process
  }
};

/**
 * Records a status change timeline entry
 */
export const recordStatusChange = async ({ caseId, performedBy, previousStatus, newStatus }) => {
  return recordTimelineEntry({
    caseId,
    actionType: 'status_changed',
    description: `Status changed from ${previousStatus} to ${newStatus}`,
    performedBy,
    previousValue: previousStatus,
    newValue: newStatus,
  });
};

/**
 * Records a document upload timeline entry
 */
export const recordDocumentUpload = async ({ caseId, performedBy, documentName, documentType }) => {
  return recordTimelineEntry({
    caseId,
    actionType: 'document_uploaded',
    description: `Document uploaded: ${documentName}`,
    performedBy,
    metadata: { documentName, documentType },
  });
};

/**
 * Records a document review timeline entry
 */
export const recordDocumentReview = async ({ caseId, performedBy, documentName, reviewStatus }) => {
  return recordTimelineEntry({
    caseId,
    actionType: 'document_reviewed',
    description: `Document reviewed: ${documentName} - ${reviewStatus}`,
    performedBy,
    metadata: { documentName, reviewStatus },
  });
};

/**
 * Records a payment timeline entry
 */
export const recordPayment = async ({ caseId, performedBy, amount, paymentType }) => {
  return recordTimelineEntry({
    caseId,
    actionType: paymentType === 'received' ? 'payment_received' : 'payment_recorded',
    description: `Payment ${paymentType}: $${amount}`,
    performedBy,
    metadata: { amount, paymentType },
  });
};

/**
 * Records a note addition timeline entry
 */
export const recordNoteAdded = async ({ caseId, performedBy, notePreview }) => {
  return recordTimelineEntry({
    caseId,
    actionType: 'note_added',
    description: `Note added: ${notePreview}`,
    performedBy,
  });
};

/**
 * Records an assignment change timeline entry
 */
export const recordAssignmentChange = async ({ caseId, performedBy, previousAssignees, newAssignees }) => {
  return recordTimelineEntry({
    caseId,
    actionType: 'assignment_changed',
    description: 'Caseworker assignment changed',
    performedBy,
    previousValue: JSON.stringify(previousAssignees),
    newValue: JSON.stringify(newAssignees),
    metadata: { previousAssignees, newAssignees },
  });
};

/**
 * Records a case creation timeline entry
 */
export const recordCaseCreated = async ({ caseId, performedBy, caseDetails }) => {
  return recordTimelineEntry({
    caseId,
    actionType: 'case_created',
    description: 'Case created',
    performedBy,
    metadata: caseDetails,
  });
};
