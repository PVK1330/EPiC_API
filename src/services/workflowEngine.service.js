import logger from '../utils/logger.js';
import { recordTimelineEntry } from './caseTimeline.service.js';
import { notifyUser, NotificationTypes, NotificationPriority } from './notification.service.js';
// Reusing existing email service conceptually if needed, or trigger via other services
import { sendWorkflowStageEmail } from './workflowEmail.service.js';
import { emitToUser, EVENT_TYPES } from '../realtime/messagingRealtime.js';

// --- Transition Matrices ---

const CASE_TRANSITIONS = {
  client_enquiry: ['admin_assignment', 'case_closure'],
  admin_assignment: ['initial_consultation', 'data_capture_initial_docs', 'case_closure'],
  initial_consultation: ['data_capture_initial_docs', 'case_closure'],
  data_capture_initial_docs: ['application_preparation', 'further_information_request', 'case_closure'],
  application_preparation: ['document_review', 'further_information_request', 'case_closure'],
  document_review: ['draft_application_review', 'further_information_request', 'case_closure'],
  further_information_request: ['application_preparation', 'document_review', 'case_closure'],
  draft_application_review: ['client_care_letter', 'further_information_request', 'case_closure'],
  client_care_letter: ['application_submitted', 'case_closure'],
  ccl_payment_received: ['application_submitted', 'case_closure'], // Legacy
  application_submitted: ['biometrics_booked', 'awaiting_decision', 'case_closure'],
  biometrics_booked: ['biometrics_confirmation_sent', 'documents_uploaded', 'case_closure'],
  biometrics_confirmation_sent: ['documents_uploaded', 'awaiting_decision', 'case_closure'],
  documents_uploaded: ['awaiting_decision', 'case_closure'],
  awaiting_decision: ['decision_communicated', 'case_closure'],
  decision_communicated: ['case_closure'],
  case_closure: []
};

// Based on user requirements but mapping to our existing legacy states that we cannot rename
const LICENCE_TRANSITIONS = {
  'Pending': ['Information Requested', 'Approved', 'Rejected'], // DRAFT -> SUBMITTED
  'Information Requested': ['Pending', 'Rejected'], // ADDITIONAL_INFO -> UNDER_REVIEW
  'Approved': ['Expired'], // LICENCE_GRANTED
  'Rejected': [],
  'Expired': []
};

const COS_REQUEST_TRANSITIONS = {
  'Pending': ['Under Review', 'Approved', 'Rejected'],
  'Under Review': ['Approved', 'Rejected'],
  'Approved': ['Allocated'],
  'Allocated': ['Used', 'Expired', 'Revoked'],
  'Used': [],
  'Expired': [],
  'Revoked': []
};

const SPONSOR_LIFECYCLE_TRANSITIONS = {
  'Registered': ['Verified'], // BUSINESS_REGISTERED -> OTP_VERIFIED
  'Verified': ['Profile Created'],
  'Profile Created': ['Licence Required'],
  'Licence Required': ['Application Started'],
  'Application Started': ['Documents Pending'],
  'Documents Pending': ['Documents Submitted'],
  'Documents Submitted': ['Under Review'],
  'Under Review': ['Approved', 'Rejected'],
  'Approved': ['Active Sponsor'],
  'Rejected': [],
  'Active Sponsor': []
};

export const WORKFLOW_TYPES = {
  CASE: 'case',
  LICENCE: 'licence',
  COS: 'cos',
  SPONSOR: 'sponsor'
};

const MATRICES = {
  [WORKFLOW_TYPES.CASE]: CASE_TRANSITIONS,
  [WORKFLOW_TYPES.LICENCE]: LICENCE_TRANSITIONS,
  [WORKFLOW_TYPES.COS]: COS_REQUEST_TRANSITIONS,
  [WORKFLOW_TYPES.SPONSOR]: SPONSOR_LIFECYCLE_TRANSITIONS
};

/**
 * Validates if a transition is allowed based on the strict matrix
 */
export function validateTransition(workflowType, currentState, nextState) {
  const matrix = MATRICES[workflowType];
  if (!matrix) return { valid: true }; // Opt-out if workflow type not registered

  // If there's no current state, assume it's the beginning of the flow (valid)
  if (!currentState) return { valid: true };

  const allowedNext = matrix[currentState];
  
  if (!allowedNext) {
    return { valid: false, message: `Current state '${currentState}' is terminal or unrecognized.` };
  }

  if (!allowedNext.includes(nextState)) {
    return { valid: false, message: `Invalid transition from '${currentState}' to '${nextState}'. Allowed: ${allowedNext.join(', ')}` };
  }

  return { valid: true };
}

/**
 * The core WorkflowEngine transition method.
 * Executes in strict sequence: Validate -> Persist -> Audit -> Timeline -> Notification -> Email -> Socket.
 */
export async function executeWorkflowTransition({
  tenantDb,
  workflowType,
  entityRecord,
  currentState,
  nextState,
  performedBy, // The actor userId performing the action
  reason = 'Workflow state advanced',
  organisationId = null,
  updateFunction, // async function() => void - provided by caller to persist to DB
  notifyUserIds = [], // Array of user IDs to notify (e.g. candidate, caseworker, admin)
  emailConfig = null // Config to pass to email service
}) {
  
  // 1. Validate Transition
  const validation = validateTransition(workflowType, currentState, nextState);
  if (!validation.valid) {
    logger.warn({ workflowType, currentState, nextState }, `Prevented invalid transition: ${validation.message}`);
    throw new Error(`State Transition Error: ${validation.message}`);
  }

  // 2. Persist Change (Call the specific DB update logic)
  if (updateFunction && typeof updateFunction === 'function') {
    await updateFunction();
  }

  const entityId = entityRecord.id || 'system';

  // 3. Audit Log
  try {
    if (tenantDb && tenantDb.AuditLog) {
      await tenantDb.AuditLog.create({
        user_id: performedBy || 1, // System default if null
        action: `WORKFLOW_TRANSITION_${workflowType.toUpperCase()}`,
        entity_type: workflowType,
        resource: String(entityId),
        status: 'Success',
        details: `Transitioned from ${currentState || 'None'} to ${nextState}. Reason: ${reason}`
      });
    }
  } catch (auditErr) {
    logger.error({ err: auditErr }, 'WorkflowEngine: Failed to create Audit Log');
  }

  // 4. Timeline Entry
  try {
    if (tenantDb && workflowType === WORKFLOW_TYPES.CASE && entityRecord.id) {
      await recordTimelineEntry({
        tenantDb,
        caseId: entityRecord.id,
        actionType: 'status_change',
        description: reason,
        performedBy,
        previousValue: currentState,
        newValue: nextState,
        visibility: 'public'
      });
    }
  } catch (timelineErr) {
    logger.error({ err: timelineErr }, 'WorkflowEngine: Failed to create Timeline Entry');
  }

  // 5. Notification (Enforcing "Never Notify Actor" rule)
  const filteredUsersToNotify = notifyUserIds.filter(userId => String(userId) !== String(performedBy));
  
  try {
    for (const targetUserId of filteredUsersToNotify) {
      await notifyUser(tenantDb, targetUserId, {
        type: NotificationTypes.INFO,
        priority: NotificationPriority.MEDIUM,
        title: `Workflow Updated: ${nextState}`,
        message: `The ${workflowType} workflow has been updated to ${nextState}.`,
        actionType: 'workflow_update',
        entityId: entityId,
        entityType: workflowType
      });
    }
  } catch (notifyErr) {
    logger.error({ err: notifyErr }, 'WorkflowEngine: Failed to generate Notification');
  }

  // 6. Email Event
  try {
    if (emailConfig && workflowType === WORKFLOW_TYPES.CASE) {
      await sendWorkflowStageEmail({
        tenantDb,
        caseRecord: entityRecord,
        stageId: nextState,
        organisationId
      });
    }
  } catch (emailErr) {
    logger.error({ err: emailErr }, 'WorkflowEngine: Failed to send Email');
  }

  // 7. Socket Event (Real-time Integration)
  try {
    for (const targetUserId of filteredUsersToNotify) {
      emitToUser(targetUserId, EVENT_TYPES.NOTIFICATION_NEW, {
        type: 'workflow_update',
        workflowType,
        entityId,
        previousState: currentState,
        newState: nextState,
        timestamp: new Date().toISOString()
      });
    }
    
    // Also broadcast a generic update if needed
    if (workflowType === WORKFLOW_TYPES.CASE && entityRecord.candidateId) {
      emitToUser(entityRecord.candidateId, EVENT_TYPES.CASE_UPDATED, { caseId: entityRecord.id });
    }
  } catch (socketErr) {
    logger.error({ err: socketErr }, 'WorkflowEngine: Failed to emit Socket Event');
  }

  return { previousState: currentState, newState: nextState, success: true };
}
