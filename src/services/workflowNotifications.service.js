import { Op } from "sequelize";
import logger from "../utils/logger.js";
import { getStepById } from "../constants/immigrationCaseProcess.js";
import {
  notifyUser,
  notifyAdmins,
  notifyTaskAssigned,
  NotificationTypes,
  NotificationPriority,
} from "./notification.service.js";
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

async function getActiveAdminIds(tenantDb) {
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

function dueDateInDays(days = 2) {
  return localDateAfterDays(days);
}

/**
 * Notify candidate, assigned caseworkers, and admins when a case stage changes.
 */
export async function notifyWorkflowStageChange({
  tenantDb,
  caseRecord,
  previousStage,
  nextStage,
  performedBy = null,
  organisationId = null,
}) {
  if (!tenantDb || !caseRecord || !nextStage || previousStage === nextStage) return;

  const step = getStepById(nextStage);
  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
  const title = `Workflow: ${step?.title || nextStage}`;
  const message = `Case ${caseLabel} has moved to "${step?.title || nextStage}".`;

  const base = {
    tenantDb,
    type: NotificationTypes.CASE_STATUS_CHANGED,
    priority: NotificationPriority.MEDIUM,
    title,
    message,
    actionType: "case_stage_change",
    entityId: caseRecord.id,
    entityType: "case",
    metadata: {
      caseId: caseLabel,
      previousStage,
      nextStage,
      stageTitle: step?.title || nextStage,
    },
    sendEmail: true,
    organisationId,
  };

  const candidateId = caseRecord.candidateId;
  if (candidateId && candidateId !== performedBy) {
    const result = await notifyUser(tenantDb, candidateId, base);
    if (!result) {
      logger.error({ caseId: caseRecord.id, targetId: candidateId, previousStage, nextStage }, "notifyWorkflowStageChange: failed to notify candidate");
    }
  }

  const caseworkerIds = parseCaseworkerIds(caseRecord);
  for (const cwId of caseworkerIds) {
    if (cwId && cwId !== performedBy) {
      const result = await notifyUser(tenantDb, cwId, base);
      if (!result) {
        logger.error({ caseId: caseRecord.id, targetId: cwId, previousStage, nextStage }, "notifyWorkflowStageChange: failed to notify caseworker");
      }
    }
  }

  const adminResults = await notifyAdmins(tenantDb, { ...base, isInternalAdminOnly: true });
  if (!adminResults || !adminResults.length) {
    logger.error({ caseId: caseRecord.id, previousStage, nextStage }, "notifyWorkflowStageChange: failed to notify admins");
  }
}


/**
 * Create a high-priority task for each active admin (e.g. CCL payment approval).
 */
export async function createAdminWorkflowTask({
  tenantDb,
  caseRecord,
  title,
  createdBy,
  priority = "high",
  dueInDays = 2,
  organisationId = null,
}) {
  if (!tenantDb || !caseRecord || !title) return [];

  const adminIds = await getActiveAdminIds(tenantDb);
  if (!adminIds.length) return [];

  const creatorId = createdBy || adminIds[0];
  const due_date = dueDateInDays(dueInDays);
  const created = [];

  for (const adminId of adminIds) {
    const existing = await tenantDb.Task.findOne({
      where: {
        case_id: caseRecord.id,
        assigned_to: adminId,
        status: "pending",
        title: { [Op.iLike]: `${String(title).trim().slice(0, 40)}%` },
      },
    });
    if (existing) {
      created.push(existing);
      continue;
    }

    const task = await tenantDb.Task.create({
      title: String(title).trim(),
      assigned_to: adminId,
      case_id: caseRecord.id,
      priority: ["low", "medium", "high"].includes(priority) ? priority : "high",
      status: "pending",
      due_date,
      created_by: creatorId,
    });
    created.push(task);
    const plain = task.get({ plain: true });
    const notification = await notifyTaskAssigned(tenantDb, adminId, {
      ...plain,
      organisationId,
      metadata: { caseId: caseRecord.caseId || `#${caseRecord.id}` },
    });
    if (!notification) {
      logger.error({ caseId: caseRecord.id, taskId: task.id, assigneeId: adminId }, "createAdminWorkflowTask: failed to notify assigned admin");
    }
  }

  return created;
}

export async function notifyCclFeeProposed({
  tenantDb,
  caseRecord,
  ccl,
  proposedBy,
  organisationId = null,
}) {
  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
  const fee = Number(ccl?.feeAmount || 0).toFixed(2);
  const count = Array.isArray(ccl?.installmentPlan) ? ccl.installmentPlan.length : 0;

  const adminResults = await notifyAdmins(tenantDb, {
    tenantDb,
    type: NotificationTypes.INFO,
    priority: NotificationPriority.HIGH,
    title: `CCL payment approval required — ${caseLabel}`,
    message: `Caseworker proposed £${fee} across ${count} instalment(s). Review and approve before the client can see payment details.`,
    actionType: "ccl_fee_review",
    entityId: caseRecord.id,
    entityType: "case",
    metadata: { caseId: caseLabel, feeAmount: ccl?.feeAmount, installments: count },
    sendEmail: true,
    isInternalAdminOnly: true,
    organisationId,
  });
  if (!adminResults || !adminResults.length) {
    logger.error({ caseId: caseRecord.id }, "notifyCclFeeProposed: failed to notify admins");
  }

  // Admin tasks are created by syncWorkflowTasksForStage on ccl_fee_admin_review (avoid duplicates).
}

export async function notifyCclFeeApproved({
  tenantDb,
  caseRecord,
  ccl,
  organisationId = null,
}) {
  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
  const fee = Number(ccl?.feeAmount || 0).toFixed(2);

  if (caseRecord.candidateId) {
    const candidateResult = await notifyUser(tenantDb, caseRecord.candidateId, {
      tenantDb,
      type: NotificationTypes.PAYMENT_RECEIVED,
      priority: NotificationPriority.HIGH,
      title: `Client Care Letter & payment schedule — ${caseLabel}`,
      message: `Your Client Care Letter (CCL) fee is £${fee}. This is the amount you need to pay. Review your CCL and complete payment from the Payments section when ready.`,
      actionType: "ccl_issued",
      entityId: caseRecord.id,
      entityType: "case",
      metadata: { caseId: caseLabel, feeAmount: ccl?.feeAmount },
      sendEmail: true,
      organisationId,
    });
    if (!candidateResult) {
      logger.error({ caseId: caseRecord.id, candidateId: caseRecord.candidateId }, "notifyCclFeeApproved: failed to notify candidate");
    }
  }

  const caseworkerIds = parseCaseworkerIds(caseRecord);
  for (const cwId of caseworkerIds) {
    const result = await notifyUser(tenantDb, cwId, {
      tenantDb,
      type: NotificationTypes.SUCCESS,
      priority: NotificationPriority.MEDIUM,
      title: `CCL fees approved — ${caseLabel}`,
      message: `Admin approved the fee proposal (£${fee}). The Client Care Letter has been released to the client.`,
      actionType: "ccl_fee_approved",
      entityId: caseRecord.id,
      entityType: "case",
      metadata: { caseId: caseLabel },
      sendEmail: false,
    });
    if (!result) {
      logger.error({ caseId: caseRecord.id, caseworkerId: cwId }, "notifyCclFeeApproved: failed to notify caseworker");
    }
  }
}

export async function notifyCclFeeRejected({
  tenantDb,
  caseRecord,
  reviewNotes,
  proposedBy,
  organisationId = null,
}) {
  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
  const msg = reviewNotes
    ? `Admin returned the CCL fee proposal: ${reviewNotes}`
    : "Admin returned the CCL fee proposal for revision.";

  if (proposedBy) {
    const result = await notifyUser(tenantDb, proposedBy, {
      tenantDb,
      type: NotificationTypes.WARNING,
      priority: NotificationPriority.HIGH,
      title: `CCL fees need revision — ${caseLabel}`,
      message: msg,
      actionType: "ccl_fee_rejected",
      entityId: caseRecord.id,
      entityType: "case",
      metadata: { caseId: caseLabel, reviewNotes },
      sendEmail: true,
      organisationId,
    });
    if (!result) {
      logger.error({ caseId: caseRecord.id, targetId: proposedBy }, 'notifyCclFeeRejected: failed to notify proposer');
    }
  } else {
    const caseworkerIds = parseCaseworkerIds(caseRecord);
    for (const cwId of caseworkerIds) {
      const result = await notifyUser(tenantDb, cwId, {
        tenantDb,
        type: NotificationTypes.WARNING,
        priority: NotificationPriority.HIGH,
        title: `CCL fees need revision — ${caseLabel}`,
        message: msg,
        actionType: "ccl_fee_rejected",
        entityId: caseRecord.id,
        entityType: "case",
        sendEmail: true,
        organisationId,
      });
      if (!result) {
        logger.error({ caseId: caseRecord.id, caseworkerId: cwId }, 'notifyCclFeeRejected: failed to notify caseworker');
      }
    }
  }
}
