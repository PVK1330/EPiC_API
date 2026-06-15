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
  application_preparation: ['document_review', 'draft_application_review', 'client_care_letter', 'further_information_request', 'case_closure'],
  document_review: ['draft_application_review', 'client_care_letter', 'further_information_request', 'case_closure'],
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

// Role IDs permitted to record a final 'Approved' decision on a licence.
// Defined inline to avoid a circular import from role.middleware.js.
//   3 = ROLES.ADMIN   5 = ROLES.SUPERADMIN
const LICENCE_APPROVER_ROLE_IDS = new Set([3, 5]);

const LICENCE_TRANSITIONS = {
  'Draft':                  ['Pending'],
  'Pending':                ['Under Review', 'Information Requested', 'Approved', 'Rejected'],
  // 'Approved' removed: no-one may skip Government Processing from Under Review.
  // The only legal path to Approved is: Government Processing → Decision Pending → Approved.
  'Under Review':           ['Information Requested', 'Government Processing', 'Rejected'],
  'Information Requested':  ['Under Review', 'Rejected'],
  'Government Processing':  ['Decision Pending', 'Information Requested', 'Rejected'],
  'Decision Pending':       ['Approved', 'Rejected'],
  'Approved':               ['Expired'],
  'Rejected':               [],
  'Expired':                []
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
 * Validates if a transition is allowed based on the strict matrix.
 *
 * @param {string} workflowType   - One of WORKFLOW_TYPES.*
 * @param {string} currentState   - The application's present status (must not be null/undefined)
 * @param {string} nextState      - The desired target status
 * @param {{ roleId?: number|string }} [options]
 *   roleId — when provided, enforces role-aware constraints on top of the matrix.
 *   For LICENCE workflows, only ADMIN and SUPERADMIN may record 'Approved';
 *   caseworkers must advance the case to 'Decision Pending' for an admin to confirm.
 * @returns {{ valid: boolean, message?: string }}
 */
export function validateTransition(workflowType, currentState, nextState, options = {}) {
  const matrix = MATRICES[workflowType];
  // Unknown workflow types are rejected — a missing matrix entry is a programmer error,
  // not a signal to let all transitions through.
  if (!matrix) {
    return { valid: false, message: `Unknown workflow type '${workflowType}'. Transition blocked.` };
  }

  // A null/undefined currentState is not a valid starting point; callers must
  // supply the application's actual status before requesting a transition.
  if (!currentState) {
    return { valid: false, message: 'Current state is required for transition validation.' };
  }

  const allowedNext = matrix[currentState];

  if (!allowedNext) {
    return { valid: false, message: `Current state '${currentState}' is terminal or unrecognized.` };
  }

  if (!allowedNext.includes(nextState)) {
    return { valid: false, message: `Invalid transition from '${currentState}' to '${nextState}'. Allowed: ${allowedNext.join(', ')}` };
  }

  // Role-aware constraint for the LICENCE workflow: only ADMIN / SUPERADMIN may
  // record an 'Approved' outcome. Caseworkers drive the pipeline forward
  // (Under Review → Government Processing → Decision Pending) but cannot make
  // the final approval call — that belongs to an administrator.
  if (workflowType === WORKFLOW_TYPES.LICENCE && nextState === 'Approved' && options.roleId !== undefined) {
    const roleId = Number(options.roleId);
    if (!LICENCE_APPROVER_ROLE_IDS.has(roleId)) {
      return {
        valid: false,
        message: `Only administrators may record a licence approval. Advance the case to 'Decision Pending' and ask an administrator to confirm the final decision.`
      };
    }
  }

  return { valid: true };
}

/**
 * Find the shortest sequence of valid intermediate states from `currentState`
 * to `targetState` using the transition matrix (BFS). Returns the list of
 * states to step *through*, EXCLUDING the current state and INCLUDING the
 * target — e.g. ['application_preparation', 'client_care_letter']. Returns:
 *   - []    when already at the target,
 *   - null  when no legal path exists.
 *
 * Used when a business action (e.g. proposing CCL fees) must land the case on a
 * specific stage that isn't always a direct neighbour of the current stage.
 */
export function findTransitionPath(workflowType, currentState, targetState) {
  const matrix = MATRICES[workflowType];
  if (!matrix) return [targetState];
  if (!currentState || currentState === targetState) return [];

  const queue = [[currentState, []]];
  const visited = new Set([currentState]);

  while (queue.length) {
    const [state, path] = queue.shift();
    for (const next of matrix[state] || []) {
      if (visited.has(next)) continue;
      const nextPath = [...path, next];
      if (next === targetState) return nextPath;
      visited.add(next);
      queue.push([next, nextPath]);
    }
  }
  return null;
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
