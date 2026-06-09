import { resolveCaseStage } from "../constants/immigrationCaseProcess.js";
import { applyCaseStageChange } from "./caseStageAutomation.service.js";
import { findTransitionPath, WORKFLOW_TYPES } from "./workflowEngine.service.js";
import { recordTimelineEntry } from "./caseTimeline.service.js";
import {
  notifyCclFeeProposed,
  notifyCclFeeApproved,
  notifyCclFeeRejected,
  createAdminWorkflowTask,
} from "./workflowNotifications.service.js";
import { attachCclTemplateToCase } from "./cclTemplate.service.js";
import logger from "../utils/logger.js";

export function normalizeInstallments(installments = []) {
  if (!Array.isArray(installments)) return [];
  return installments.map((row, i) => ({
    label: String(row.label || `Instalment ${i + 1}`).trim(),
    amount: Number.parseFloat(row.amount) || 0,
    dueDate: row.dueDate || null,
  }));
}

export function validateInstallmentPlan(total, installments) {
  const fee = Number.parseFloat(total) || 0;
  if (fee <= 0) {
    return { ok: false, message: "Total fee must be greater than zero" };
  }
  if (!installments.length) {
    return { ok: false, message: "Add at least one instalment" };
  }
  const sum = installments.reduce((s, r) => s + r.amount, 0);
  if (Math.abs(sum - fee) > 0.02) {
    return {
      ok: false,
      message: `Instalments (£${sum.toFixed(2)}) must equal total fee (£${fee.toFixed(2)})`,
    };
  }
  return { ok: true };
}

/**
 * Move a case to the `client_care_letter` stage along the shortest VALID path.
 *
 * CCL fees can be proposed/reviewed from several earlier stages (and, via the
 * allowFromAnyStage flag, from any stage at all). A direct jump to
 * `client_care_letter` is rejected by the state machine when the case is not a
 * direct neighbour (e.g. `data_capture_initial_docs`), surfacing as the
 * "Invalid transition … Allowed: …" error. Walking the BFS path keeps every hop
 * legal. Intermediate hops are silent; only the final landing may email.
 */
async function advanceToClientCareLetter({
  tenantDb,
  caseRecord,
  performedBy,
  reason,
  emailOnArrival = false,
  organisationId = null,
}) {
  const currentStage = resolveCaseStage(caseRecord);
  const path =
    findTransitionPath(WORKFLOW_TYPES.CASE, currentStage, "client_care_letter") || [
      "client_care_letter",
    ];

  for (let i = 0; i < path.length; i += 1) {
    const stageId = path[i];
    const isFinal = i === path.length - 1;
    await applyCaseStageChange({
      tenantDb,
      caseRecord,
      nextStageId: stageId,
      performedBy,
      reason,
      sendEmail: emailOnArrival && isFinal,
      organisationId,
    });
    await caseRecord.reload();
  }
}

/**
 * Shared CCL fee proposal — used by workflow API and legacy finance PATCH.
 * Creates/updates CaseCclRecord, advances stage, notifies admins, creates stage tasks.
 */
export async function submitCclFeeProposal({
  tenantDb,
  caseRecord,
  feeAmount,
  installments,
  notes = null,
  proposedBy,
  organisationId = null,
  documentId = null,
  allowFromAnyStage = false,
}) {
  if (!tenantDb || !caseRecord) {
    return { ok: false, status: 400, message: "Case not found" };
  }

  const stage = resolveCaseStage(caseRecord);
  const existingCcl = await tenantDb.CaseCclRecord.findOne({
    where: { caseId: caseRecord.id },
  });

  const canPropose =
    allowFromAnyStage ||
    ["draft_application_review", "client_care_letter", "application_preparation", "document_review"].includes(
      stage,
    ) ||
    existingCcl?.status === "fee_rejected";

  if (!canPropose) {
    return {
      ok: false,
      status: 400,
      message:
        "Fees can only be proposed after draft review, or when admin has returned the proposal for revision",
    };
  }

  const plan = normalizeInstallments(installments);
  const validation = validateInstallmentPlan(feeAmount, plan);
  if (!validation.ok) {
    return { ok: false, status: 400, message: validation.message };
  }

  const [ccl] = await tenantDb.CaseCclRecord.findOrCreate({
    where: { caseId: caseRecord.id },
    defaults: { status: "pending", installmentPlan: [] },
  });

  if (ccl.status === "issued" || ccl.status === "signed") {
    return { ok: false, status: 400, message: "CCL already issued to client" };
  }

  await ccl.update({
    status: "fee_proposed",
    feeAmount,
    installmentPlan: plan,
    proposedBy: proposedBy || ccl.proposedBy,
    proposedAt: new Date(),
    issuedDocumentId: documentId || ccl.issuedDocumentId,
    notes: notes ?? ccl.notes,
    adminReviewNotes: null,
  });

  await caseRecord.update({
    totalAmount: feeAmount,
    amountStatus: "Pending Approval",
    amountNotes: notes ?? caseRecord.amountNotes,
  });

  if (resolveCaseStage(caseRecord) !== "client_care_letter") {
    await advanceToClientCareLetter({
      tenantDb,
      caseRecord,
      performedBy: proposedBy,
      reason: "CCL fees and instalments submitted for admin approval",
      emailOnArrival: false,
      organisationId,
    });
  }

  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
  await createAdminWorkflowTask({
    tenantDb,
    caseRecord,
    title: `Approve CCL fee proposal — ${caseLabel}`,
    createdBy: proposedBy,
    priority: "high",
    dueInDays: 1,
    organisationId,
  }).catch((err) => logger.error({ err }, "createAdminWorkflowTask"));

  await recordTimelineEntry({
    tenantDb,
    caseId: caseRecord.id,
    actionType: "case_updated",
    description: `CCL fee proposal submitted: £${Number(feeAmount).toFixed(2)} (${plan.length} instalments)`,
    performedBy: proposedBy,
    metadata: { feeAmount, installments: plan },
    visibility: "internal",
  });

  await ccl.reload();
  await caseRecord.reload();

  await notifyCclFeeProposed({
    tenantDb,
    caseRecord,
    ccl,
    proposedBy,
    organisationId,
  }).catch((err) => logger.error({ err }, "notifyCclFeeProposed"));

  return { ok: true, ccl, caseRecord };
}

/** Admin approve or reject a proposed CCL fee schedule. */
export async function reviewCclFeeProposal({
  tenantDb,
  caseRecord,
  action,
  reviewNotes = null,
  reviewedBy,
  organisationId = null,
}) {
  if (!tenantDb || !caseRecord) {
    return { ok: false, status: 400, message: "Case not found" };
  }
  if (!["approve", "reject"].includes(action)) {
    return { ok: false, status: 400, message: "action must be approve or reject" };
  }

  const ccl = await tenantDb.CaseCclRecord.findOne({ where: { caseId: caseRecord.id } });
  // Normally the CCL record is `fee_proposed`. Also accept a case that is
  // `Pending Approval` with a priced CCL record whose status drifted (e.g. a
  // half-completed earlier proposal) so admins aren't blocked from actioning a
  // proposal the caseworker clearly submitted.
  const reviewable =
    ccl &&
    (ccl.status === "fee_proposed" ||
      (caseRecord.amountStatus === "Pending Approval" &&
        Number(ccl.feeAmount) > 0 &&
        !["issued", "signed"].includes(ccl.status)));
  if (!reviewable) {
    return {
      ok: false,
      status: 400,
      message: "No fee proposal awaiting admin review",
    };
  }

  if (action === "reject") {
    await ccl.update({
      status: "fee_rejected",
      adminReviewedBy: reviewedBy,
      adminReviewedAt: new Date(),
      adminReviewNotes: reviewNotes || null,
    });

    await caseRecord.update({ amountStatus: "Rejected" });

    if (resolveCaseStage(caseRecord) !== "client_care_letter") {
      await advanceToClientCareLetter({
        tenantDb,
        caseRecord,
        performedBy: reviewedBy,
        organisationId,
        reason: reviewNotes || "CCL fee proposal returned to caseworker",
        emailOnArrival: false,
      });
    }

    await recordTimelineEntry({
      tenantDb,
      caseId: caseRecord.id,
      actionType: "case_updated",
      description: "CCL fee proposal rejected by admin",
      performedBy: reviewedBy,
      metadata: { reviewNotes },
      visibility: "internal",
    });

    await notifyCclFeeRejected({
      tenantDb,
      caseRecord,
      reviewNotes,
      proposedBy: ccl.proposedBy,
      organisationId,
    }).catch((err) => logger.error({ err }, "notifyCclFeeRejected"));

    return { ok: true, ccl, caseRecord };
  }

  await ccl.update({
    status: "issued",
    issuedAt: new Date(),
    issuedBy: reviewedBy,
    adminReviewedBy: reviewedBy,
    adminReviewedAt: new Date(),
    adminReviewNotes: reviewNotes || null,
  });

  await caseRecord.update({
    totalAmount: ccl.feeAmount,
    amountStatus: "Approved",
  });

  if (resolveCaseStage(caseRecord) !== "client_care_letter") {
    await advanceToClientCareLetter({
      tenantDb,
      caseRecord,
      performedBy: reviewedBy,
      reason: "CCL fees approved — Client Care Letter released to client",
      emailOnArrival: true,
      organisationId,
    });
  } else {
    const { sendWorkflowStageEmail } = await import("./workflowEmail.service.js");
    await sendWorkflowStageEmail({
      tenantDb,
      caseRecord,
      stageId: "client_care_letter",
      organisationId,
    });
  }

  await recordTimelineEntry({
    tenantDb,
    caseId: caseRecord.id,
    actionType: "communication_sent",
    description: "Client Care Letter and fee schedule sent to client",
    performedBy: reviewedBy,
    metadata: {
      feeAmount: ccl.feeAmount,
      installments: ccl.installmentPlan,
    },
    visibility: "public",
  });

  await ccl.reload();
  if (tenantDb.VisaType) {
    await caseRecord.reload({
      include: [{ model: tenantDb.VisaType, as: "visaType", attributes: ["id", "name"] }],
    });
  } else {
    await caseRecord.reload();
  }

  await attachCclTemplateToCase({
    tenantDb,
    caseRecord,
    ccl,
    performedBy: reviewedBy,
  }).catch((err) => logger.error({ err }, "attachCclTemplateToCase"));

  await ccl.reload();

  await notifyCclFeeApproved({
    tenantDb,
    caseRecord,
    ccl,
    organisationId,
  }).catch((err) => logger.error({ err }, "notifyCclFeeApproved"));



  return { ok: true, ccl, caseRecord };
}
