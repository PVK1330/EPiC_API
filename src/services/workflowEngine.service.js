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
  biometrics_booked: ['biometrics_confirmation_sent', 'documents_uploaded', 'awaiting_decision', 'case_closure'],
  biometrics_confirmation_sent: ['documents_uploaded', 'awaiting_decision', 'case_closure'],
  documents_uploaded: ['awaiting_decision', 'case_closure'],
  awaiting_decision: ['decision_communicated', 'case_closure'],
  decision_communicated: ['case_closure'],
  case_closure: []
};

// Role IDs permitted to record a final 'Approved' decision on a licence.
// Defined inline to avoid a circular import from role.middleware.js.
//   2 = ROLES.CASEWORKER   3 = ROLES.ADMIN   5 = ROLES.SUPERADMIN
// Caseworkers may record the final grant/close once the sponsor has confirmed the
// UKVI decision (that prerequisite is enforced separately in grantLicence()).
const LICENCE_APPROVER_ROLE_IDS = new Set([2, 3, 5]);

const LICENCE_TRANSITIONS = {
  'Draft':                  ['Pending'],
  'Pending':                ['Under Review', 'Information Requested', 'Approved', 'Rejected'],
  // Direct 'Approved'/'Rejected' kept for legacy V1 flows.
  // The formal grant path is: Government Processing → Decision Pending → Licence Granted | Licence Rejected.
  'Under Review':           ['Information Requested', 'Government Processing', 'Rejected'],
  'Information Requested':  ['Under Review', 'Rejected'],
  'Government Processing':  ['Decision Pending', 'Information Requested', 'Rejected'],
  'Decision Pending':       ['Licence Granted', 'Licence Rejected', 'Approved', 'Rejected'],
  'Approved':               ['Expired'],
  'Rejected':               [],
  'Licence Granted':        ['Expired'],
  'Licence Rejected':       [],
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

const WORKER_TRANSITIONS = {
  'CoS Assigned':           ['Immigration Assessment', 'Visa Rejected'],
  'Immigration Assessment': ['Visa Preparation', 'Visa Rejected'],
  'Visa Preparation':       ['Compliance Review', 'Visa Rejected'],
  'Compliance Review':      ['Visa Decision', 'Visa Rejected'],
  'Visa Decision':          ['Visa Granted', 'Visa Rejected'],
  'Visa Granted':           [],
  'Visa Rejected':          [],
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
  SPONSOR: 'sponsor',
  WORKER: 'worker',
};

const MATRICES = {
  [WORKFLOW_TYPES.CASE]: CASE_TRANSITIONS,
  [WORKFLOW_TYPES.LICENCE]: LICENCE_TRANSITIONS,
  [WORKFLOW_TYPES.COS]: COS_REQUEST_TRANSITIONS,
  [WORKFLOW_TYPES.SPONSOR]: SPONSOR_LIFECYCLE_TRANSITIONS,
  [WORKFLOW_TYPES.WORKER]: WORKER_TRANSITIONS,
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
  // record an 'Approved' or 'Licence Granted' outcome. Caseworkers drive the pipeline
  // forward (Under Review → Government Processing → Decision Pending) but cannot make
  // the final approval call — that belongs to an administrator.
  const APPROVAL_STATES = new Set(['Approved', 'Licence Granted']);
  if (workflowType === WORKFLOW_TYPES.LICENCE && APPROVAL_STATES.has(nextState) && options.roleId !== undefined) {
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

/**
 * Validates whether a LicenceApplication's current status permits access to the
 * given workflow phase number (1–5).
 *
 * This function operates on `LicenceApplication.status`, NOT on
 * `SponsorProfile.licenceStatus`. Phases 4 and 5 (CoS / Sponsored Worker) also
 * require `SponsorProfile.licenceStatus = 'Active'` — that is enforced by the
 * requireActiveSponsorLicence middleware and is out of scope here.
 *
 * Phase rules:
 *   1 — always accessible (onboarding).
 *   2 — always accessible for any non-null application status.
 *   3 — application must be Under Review or later in the government pipeline.
 *   4 — application must be Approved (licence activated).
 *   5 — application must be Approved (licence activated).
 *
 * @param {string} applicationStatus - LicenceApplication.status
 * @param {number} targetPhase       - integer 1 through 5
 * @returns {{ valid: boolean, message?: string }}
 */
export function validatePhaseGate(applicationStatus, targetPhase) {
  if (!applicationStatus) {
    return { valid: false, message: "Application status is required to validate phase access." };
  }

  const phase = Number(targetPhase);

  if (phase <= 2) return { valid: true };

  if (phase === 3) {
    const phase3Statuses = new Set([
      "Under Review",
      "Information Requested",
      "Government Processing",
      "Decision Pending",
      "Approved",
      "Licence Granted",
      "Licence Rejected",
    ]);
    if (phase3Statuses.has(applicationStatus)) return { valid: true };
    return {
      valid: false,
      message:
        `Phase 3 (Licence Review & Approval) requires the application to be ` +
        `"Under Review" or later. Current status: "${applicationStatus}".`,
    };
  }

  if (phase === 4 || phase === 5) {
    const grantedStatuses = new Set(["Approved", "Licence Granted"]);
    if (grantedStatuses.has(applicationStatus)) return { valid: true };
    return {
      valid: false,
      message:
        `Phase ${phase} requires the licence application to be "Licence Granted" or "Approved" ` +
        `(SponsorProfile.licenceStatus must be "Active"). ` +
        `Current application status: "${applicationStatus}".`,
    };
  }

  return { valid: false, message: `Unknown phase: ${targetPhase}.` };
}
