import { resolveCaseStage } from "../constants/immigrationCaseProcess.js";
import { applyCaseStageChange } from "./caseStageAutomation.service.js";
import { recordTimelineEntry } from "./caseTimeline.service.js";
import { attachCclTemplateToCase } from "./cclTemplate.service.js";
import { notifyCclFeeApproved } from "./workflowNotifications.service.js";
import { createVisaPortalSubmissionTasks } from "./caseWorkflowExtended.service.js";
import {
  createWorkflowTask,
  syncWorkflowTasksForStage,
} from "./workflowTaskAutomation.service.js";
import {
  notifyUser,
  NotificationTypes,
  NotificationPriority,
} from "./notification.service.js";

function parseCaseworkerIds(caseRecord) {
  const raw = caseRecord?.assignedcaseworkerId ?? caseRecord?.assignedCaseworkerId;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? [n] : [];
}

function formatGbp(amount) {
  const n = Number.parseFloat(amount);
  if (!Number.isFinite(n) || n < 0) return "£0.00";
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
}

/** Candidate + caseworker tasks when admin sets the CCL fee (pay amount). */
export async function createAdminCclFeeWorkflowTasks({
  tenantDb,
  caseRecord,
  feeAmount,
  performedBy = null,
  organisationId = null,
}) {
  if (!tenantDb || !caseRecord) return;

  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
  const feeLabel = formatGbp(feeAmount);

  await syncWorkflowTasksForStage({
    tenantDb,
    caseRecord,
    stageId: "client_care_letter",
    performedBy,
    organisationId,
  }).catch((err) => console.error("syncWorkflowTasksForStage (admin CCL):", err));

  if (caseRecord.candidateId) {
    const payTitle = `Pay CCL fee ${feeLabel} — ${caseLabel}`;
    await createWorkflowTask({
      tenantDb,
      caseRecord,
      assigneeId: caseRecord.candidateId,
      title: payTitle,
      createdBy: performedBy || caseRecord.candidateId,
      priority: "high",
      dueInDays: 7,
      organisationId,
      skipIfExists: true,
    });

    await notifyUser(tenantDb, caseRecord.candidateId, {
      tenantDb,
      type: NotificationTypes.INFO,
      priority: NotificationPriority.HIGH,
      title: `Payment due — ${caseLabel}`,
      message: `Your Client Care Letter fee is ${feeLabel}. Open Tasks or Payments to review your CCL and pay this amount.`,
      actionType: "ccl_payment_due",
      entityId: caseRecord.id,
      entityType: "case",
      metadata: { caseId: caseLabel, feeAmount, proposedAmount: feeAmount },
      sendEmail: true,
      organisationId,
    }).catch(() => {});
  }

  for (const cwId of parseCaseworkerIds(caseRecord)) {
    await createWorkflowTask({
      tenantDb,
      caseRecord,
      assigneeId: cwId,
      title: `CCL fee ${feeLabel} set — ${caseLabel}`,
      createdBy: performedBy || cwId,
      priority: "medium",
      dueInDays: 14,
      organisationId,
      skipIfExists: true,
    });
  }
}

/**
 * Admin sets the CCL fee the candidate must pay (issued immediately, no caseworker proposal step).
 * Syncs Case.proposedAmount, Case.totalAmount, CaseCclRecord, and releases the Client Care Letter.
 */
export async function applyAdminCclFeeOnCase({
  tenantDb,
  caseRecord,
  feeAmount,
  performedBy,
  organisationId = null,
  reviewNotes = "CCL fee set by administrator",
}) {
  const parsedFee = Number.parseFloat(feeAmount);
  if (!Number.isFinite(parsedFee) || parsedFee <= 0) {
    return { ok: false, message: "CCL fee must be greater than zero" };
  }

  const installmentPlan = [
    { label: "Full Payment", amount: parsedFee, dueDate: null },
  ];
  const cclDefaults = {
    status: "issued",
    feeAmount: parsedFee,
    installmentPlan,
    proposedBy: performedBy,
    proposedAt: new Date(),
    issuedBy: performedBy,
    issuedAt: new Date(),
    adminReviewedBy: performedBy,
    adminReviewedAt: new Date(),
    adminReviewNotes: reviewNotes,
  };

  const [ccl] = await tenantDb.CaseCclRecord.findOrCreate({
    where: { caseId: caseRecord.id },
    defaults: cclDefaults,
  });

  if (ccl.status !== "issued" && ccl.status !== "signed") {
    await ccl.update(cclDefaults);
  }

  await caseRecord.update({
    proposedAmount: parsedFee,
    totalAmount: parsedFee,
    amountStatus: "Approved",
  });

  if (resolveCaseStage(caseRecord) !== "client_care_letter") {
    await applyCaseStageChange({
      tenantDb,
      caseRecord,
      nextStageId: "client_care_letter",
      performedBy,
      reason: "Admin CCL fee set — Client Care Letter released to candidate",
      sendEmail: true,
      organisationId,
    });
  }

  await recordTimelineEntry({
    tenantDb,
    caseId: caseRecord.id,
    actionType: "communication_sent",
    description: `Client Care Letter issued — CCL fee £${parsedFee.toFixed(2)} (candidate payment due)`,
    performedBy,
    metadata: { feeAmount: parsedFee, installments: installmentPlan },
    visibility: "public",
  });

  await caseRecord.reload({
    include: tenantDb.VisaType
      ? [{ model: tenantDb.VisaType, as: "visaType", attributes: ["id", "name"] }]
      : [],
  });
  await ccl.reload();

  await attachCclTemplateToCase({
    tenantDb,
    caseRecord,
    ccl,
    performedBy,
  }).catch((err) => console.error("attachCclTemplateToCase:", err));

  await notifyCclFeeApproved({
    tenantDb,
    caseRecord,
    ccl,
    organisationId,
  }).catch((err) => console.error("notifyCclFeeApproved:", err));

  await createVisaPortalSubmissionTasks({
    tenantDb,
    caseRecord,
    createdBy: performedBy,
  }).catch((err) => console.error("createVisaPortalSubmissionTasks:", err));

  await caseRecord.reload();

  await createAdminCclFeeWorkflowTasks({
    tenantDb,
    caseRecord,
    feeAmount: parsedFee,
    performedBy,
    organisationId,
  }).catch((err) => console.error("createAdminCclFeeWorkflowTasks:", err));

  return { ok: true, ccl, caseRecord, feeAmount: parsedFee };
}
