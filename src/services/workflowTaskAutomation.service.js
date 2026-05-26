import { Op } from "sequelize";
import { getStepById } from "../constants/immigrationCaseProcess.js";
import { isFeesApprovedForClient } from "./cclCandidateRelease.service.js";
import { notifyTaskAssigned, notifyUser, NotificationTypes, NotificationPriority } from "./notification.service.js";
import { localDateAfterDays } from "../utils/dateHelpers.js";

function parseCaseworkerIds(caseRecord) {
  const raw = caseRecord?.assignedcaseworkerId ?? caseRecord?.assignedCaseworkerId;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (typeof raw === "object" && raw !== null) {
    const ids = raw.ids ?? raw.caseworkers ?? Object.values(raw);
    if (Array.isArray(ids)) return ids.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? [n] : [];
}

function dueDateInDays(days = 3) {
  return localDateAfterDays(days);
}

export async function getActiveAdminIds(tenantDb) {
  const adminRole = await tenantDb.Role.findOne({
    where: { name: { [Op.iLike]: "admin" } },
    attributes: ["id"],
  });
  if (!adminRole) return [];
  const admins = await tenantDb.User.findAll({
    where: { role_id: adminRole.id, status: "active" },
    attributes: ["id"],
  });
  return admins.map((a) => a.id);
}

async function findPendingTask(tenantDb, { caseId, assigneeId, titlePrefix }) {
  return tenantDb.Task.findOne({
    where: {
      case_id: caseId,
      assigned_to: assigneeId,
      status: "pending",
      title: { [Op.iLike]: `${titlePrefix}%` },
    },
  });
}

/**
 * Create a workflow task and notify the assignee (in-app + optional email via notifyTaskAssigned).
 */
export async function createWorkflowTask({
  tenantDb,
  caseRecord,
  assigneeId,
  title,
  createdBy = null,
  priority = "medium",
  dueInDays = 3,
  organisationId = null,
  skipIfExists = true,
  skipAssigneeNotification = false,
}) {
  if (!tenantDb || !caseRecord || !assigneeId || !title) return null;

  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
  const fullTitle = String(title).trim();

  if (skipIfExists) {
    const existing = await findPendingTask(tenantDb, {
      caseId: caseRecord.id,
      assigneeId,
      titlePrefix: fullTitle.slice(0, 40),
    });
    if (existing) return existing;
  }

  const creatorId = createdBy || assigneeId;
  const task = await tenantDb.Task.create({
    title: fullTitle,
    assigned_to: assigneeId,
    case_id: caseRecord.id,
    priority: ["low", "medium", "high"].includes(priority) ? priority : "medium",
    status: "pending",
    due_date: dueDateInDays(dueInDays),
    created_by: creatorId,
  });

  const plain = task.get({ plain: true });
  if (!skipAssigneeNotification) {
    await notifyTaskAssigned(tenantDb, assigneeId, {
      ...plain,
      organisationId,
      metadata: { caseId: caseLabel, taskId: task.id },
    }).catch(() => {});
  }

  return task;
}

/** Tasks to spawn when a case enters each workflow stage. */
const STAGE_TASK_MATRIX = {
  client_enquiry: {
    admins: [{ title: "Review enquiry and assign caseworker", priority: "high", dueInDays: 1 }],
  },
  initial_consultation: {
    caseworkers: [{ title: "Conduct initial consultation", priority: "medium", dueInDays: 3 }],
  },
  data_capture_initial_docs: {
    caseworkers: [{ title: "Send Data Capture Sheet to client", priority: "high", dueInDays: 2 }],
  },
  application_preparation: {
    caseworkers: [{ title: "Prepare visa application", priority: "medium", dueInDays: 5 }],
  },
  document_review: {
    caseworkers: [{ title: "Review uploaded documents", priority: "high", dueInDays: 3 }],
  },
  further_information_request: {
    candidates: [
      {
        title: "Upload missing documents / information",
        priority: "high",
        dueInDays: 5,
        notify: true,
        message: "Your caseworker has requested additional documents or information.",
      },
    ],
    caseworkers: [{ title: "Follow up on further information request", priority: "medium", dueInDays: 3 }],
  },
  draft_application_review: {
    caseworkers: [{ title: "Send draft application to client for review", priority: "high", dueInDays: 3 }],
    candidates: [
      {
        title: "Review draft application",
        priority: "medium",
        dueInDays: 5,
        notify: true,
        message: "Your draft application is ready for review in the portal.",
      },
    ],
  },
  client_care_letter: {
    caseworkers: [{ title: "Propose CCL fees or monitor acceptance and payment", priority: "high", dueInDays: 3 }],
    admins: [{ title: "Approve CCL fee proposal when submitted", priority: "high", dueInDays: 1 }],
    candidates: [
      {
        title: "Accept Client Care Letter and pay fees",
        priority: "high",
        dueInDays: 7,
        notify: true,
        message: "Your Client Care Letter and payment schedule are ready. Please review and pay in the portal.",
      },
    ],
  },
  ccl_payment_received: {
    // Visa portal task is created directly in acceptCcl / confirmCclSigned
    // to avoid duplicates. No caseworker tasks here.
  },
  application_submitted: {
    caseworkers: [
      {
        title: "Request candidate biometric availability",
        priority: "high",
        dueInDays: 2,
      },
    ],
    candidates: [
      {
        title: "Provide biometrics appointment availability",
        priority: "high",
        dueInDays: 5,
        notify: true,
        message:
          "Please submit your preferred location, date, and time for your biometrics appointment in the portal.",
      },
    ],
  },
  biometrics_booked: {
    caseworkers: [
      {
        title: "Book biometrics slot and send confirmation to client",
        priority: "high",
        dueInDays: 2,
      },
    ],
  },
  biometrics_confirmation_sent: {
    caseworkers: [
      {
        title: "Upload biometric documents to Visa Portal",
        priority: "high",
        dueInDays: 2,
      },
    ],
    candidates: [
      {
        title: "Attend biometrics appointment",
        priority: "high",
        dueInDays: 7,
        notify: true,
        message: "Biometrics appointment details are in your portal.",
      },
    ],
  },
  documents_uploaded: {
    caseworkers: [
      {
        title: "Check visa portal email and record Home Office reply",
        priority: "high",
        dueInDays: 3,
      },
    ],
  },
  awaiting_decision: {
    caseworkers: [{ title: "Monitor Home Office decision status", priority: "low", dueInDays: 14 }],
  },
  decision_communicated: {
    caseworkers: [{ title: "Send decision letter to client", priority: "high", dueInDays: 2 }],
    candidates: [
      {
        title: "Download decision letter from Application Pack",
        priority: "medium",
        dueInDays: 5,
        notify: true,
        message: "Your visa decision is available in the portal.",
      },
    ],
  },
  case_closure: {
    caseworkers: [{ title: "Send case closure email and archive file", priority: "medium", dueInDays: 3 }],
    candidates: [
      {
        title: "Download final documents from Application Pack",
        priority: "low",
        dueInDays: 7,
        notify: true,
        message: "Your case has been closed. Final documents are available to download.",
      },
    ],
  },
};

/**
 * Create role-appropriate tasks when a case enters a workflow stage.
 */
export async function syncWorkflowTasksForStage({
  tenantDb,
  caseRecord,
  stageId,
  performedBy = null,
  organisationId = null,
}) {
  if (!tenantDb || !caseRecord || !stageId) return [];

  const rules = STAGE_TASK_MATRIX[stageId];
  if (!rules) return [];

  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
  const created = [];
  const adminIds = await getActiveAdminIds(tenantDb);
  const caseworkerIds = parseCaseworkerIds(caseRecord);
  const candidateId = caseRecord.candidateId;

  for (const spec of rules.admins || []) {
    if (
      stageId === "client_care_letter" &&
      isFeesApprovedForClient(caseRecord) &&
      /approve ccl fee/i.test(spec.title || "")
    ) {
      continue;
    }
    for (const adminId of adminIds) {
      if (adminId === performedBy) continue;
      const t = await createWorkflowTask({
        tenantDb,
        caseRecord,
        assigneeId: adminId,
        title: `${spec.title} — ${caseLabel}`,
        createdBy: performedBy || adminId,
        priority: spec.priority,
        dueInDays: spec.dueInDays,
        organisationId,
      });
      if (t) created.push(t);
    }
  }

  for (const spec of rules.caseworkers || []) {
    if (
      stageId === "client_care_letter" &&
      isFeesApprovedForClient(caseRecord) &&
      /propose ccl fees/i.test(spec.title || "")
    ) {
      continue;
    }
    for (const cwId of caseworkerIds) {
      if (cwId === performedBy) continue;
      const t = await createWorkflowTask({
        tenantDb,
        caseRecord,
        assigneeId: cwId,
        title: `${spec.title} — ${caseLabel}`,
        createdBy: performedBy || cwId,
        priority: spec.priority,
        dueInDays: spec.dueInDays,
        organisationId,
      });
      if (t) created.push(t);
    }
  }

  for (const spec of rules.candidates || []) {
    if (!candidateId || candidateId === performedBy) continue;
    const t = await createWorkflowTask({
      tenantDb,
      caseRecord,
      assigneeId: candidateId,
      title: `${spec.title} — ${caseLabel}`,
      createdBy: performedBy || caseworkerIds[0] || adminIds[0],
      priority: spec.priority,
      dueInDays: spec.dueInDays,
      organisationId,
      skipAssigneeNotification: spec.notify === true,
    });
    if (t) created.push(t);

    if (spec.notify) {
      await notifyUser(tenantDb, candidateId, {
        tenantDb,
        type: NotificationTypes.INFO,
        priority: NotificationPriority.HIGH,
        title: spec.title,
        message: spec.message || spec.title,
        actionType: "workflow_task",
        entityId: caseRecord.id,
        entityType: "case",
        metadata: { caseId: caseLabel, stageId },
        sendEmail: true,
        organisationId,
      }).catch(() => {});
    }
  }

  return created;
}

/** Mark pending workflow tasks complete by title pattern (optional assignee filter). */
export async function completePendingWorkflowTasks(
  tenantDb,
  { caseId, titlePattern, assigneeId = null },
) {
  if (!tenantDb || !caseId || !titlePattern) return 0;
  const where = {
    case_id: caseId,
    status: "pending",
    title: { [Op.iLike]: titlePattern },
  };
  if (assigneeId != null) where.assigned_to = assigneeId;
  const [count] = await tenantDb.Task.update({ status: "completed" }, { where });
  return count;
}

/** When admin assigns a new caseworker to a case. */
export async function createTasksOnCaseworkerAssignment({
  tenantDb,
  caseRecord,
  newCaseworkerIds,
  assignedBy = null,
  organisationId = null,
  assignToNames = null,
  reason = null,
}) {
  if (!tenantDb || !caseRecord || !newCaseworkerIds?.length) return [];
  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
  const step = getStepById(caseRecord.caseStage);
  const stageTitle = step?.title || "case";
  const namesLabel = assignToNames?.trim() || `${newCaseworkerIds.length} caseworker(s)`;
  const reasonSnippet = reason?.trim() ? ` — ${reason.trim()}` : "";

  const created = [];

  for (const cwId of newCaseworkerIds) {
    const t = await createWorkflowTask({
      tenantDb,
      caseRecord,
      assigneeId: cwId,
      title: `You are assigned to case ${caseLabel} (${stageTitle})`,
      createdBy: assignedBy || cwId,
      priority: "high",
      dueInDays: 2,
      organisationId,
    });
    if (t) created.push(t);
  }

  const adminIds = await getActiveAdminIds(tenantDb);
  const assignerIsAdmin = assignedBy && adminIds.includes(Number(assignedBy));

  if (assignerIsAdmin && assignedBy) {
    const adminTask = await createWorkflowTask({
      tenantDb,
      caseRecord,
      assigneeId: assignedBy,
      title: `Confirm caseworker assignment — ${caseLabel}`,
      createdBy: assignedBy,
      priority: "medium",
      dueInDays: 1,
      organisationId,
      skipAssigneeNotification: true,
    });
    if (adminTask) created.push(adminTask);

    await notifyUser(tenantDb, assignedBy, {
      tenantDb,
      type: NotificationTypes.INFO,
      priority: NotificationPriority.MEDIUM,
      title: `Caseworkers assigned — ${caseLabel}`,
      message: `You assigned ${namesLabel} to case ${caseLabel}${reasonSnippet}. Caseworkers have been notified.`,
      actionType: "case_assignment_confirmed",
      entityId: caseRecord.id,
      entityType: "case",
      metadata: {
        caseId: caseLabel,
        caseworkerIds: newCaseworkerIds,
        assignToNames: namesLabel,
        reason: reason?.trim() || null,
      },
      sendEmail: false,
      organisationId,
    }).catch(() => {});
  }

  return created;
}

/** When caseworker sends Data Capture Sheet. */
export async function createTasksOnDataCaptureSent({
  tenantDb,
  caseRecord,
  sentBy = null,
  organisationId = null,
}) {
  if (!caseRecord?.candidateId) return [];
  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;

  const task = await createWorkflowTask({
    tenantDb,
    caseRecord,
    assigneeId: caseRecord.candidateId,
    title: `Complete Data Capture Sheet — ${caseLabel}`,
    createdBy: sentBy,
    priority: "high",
    dueInDays: 5,
    organisationId,
  });

  await notifyUser(tenantDb, caseRecord.candidateId, {
    tenantDb,
    type: NotificationTypes.INFO,
    priority: NotificationPriority.HIGH,
    title: `Data Capture Sheet — ${caseLabel}`,
    message: "Please complete your Data Capture Sheet and upload required documents in the portal.",
    actionType: "data_capture_request",
    entityId: caseRecord.id,
    entityType: "case",
    metadata: { caseId: caseLabel },
    sendEmail: false,
    organisationId,
  }).catch(() => {});

  return task ? [task] : [];
}

/** When DCS is rejected — candidate must correct. */
export async function createTasksOnDataCaptureRejected({
  tenantDb,
  caseRecord,
  reviewNotes,
  reviewedBy = null,
  organisationId = null,
}) {
  if (!caseRecord?.candidateId) return [];
  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
  const msg = reviewNotes
    ? `Please correct your Data Capture Sheet: ${reviewNotes}`
    : "Please correct and resubmit your Data Capture Sheet.";

  const task = await createWorkflowTask({
    tenantDb,
    caseRecord,
    assigneeId: caseRecord.candidateId,
    title: `Revise Data Capture Sheet — ${caseLabel}`,
    createdBy: reviewedBy,
    priority: "high",
    dueInDays: 3,
    organisationId,
  });

  await notifyUser(tenantDb, caseRecord.candidateId, {
    tenantDb,
    type: NotificationTypes.WARNING,
    priority: NotificationPriority.HIGH,
    title: `Data Capture Sheet needs revision — ${caseLabel}`,
    message: msg,
    actionType: "data_capture_rejected",
    entityId: caseRecord.id,
    entityType: "case",
    metadata: { caseId: caseLabel, reviewNotes },
    sendEmail: true,
    organisationId,
  }).catch(() => {});

  return task ? [task] : [];
}
