import { resolveCaseStage } from "../constants/immigrationCaseProcess.js";
import { applyCaseStageChange } from "./caseStageAutomation.service.js";
import { recordTimelineEntry } from "./caseTimeline.service.js";
import {
  notifyCclFeeProposed,
  notifyCclFeeApproved,
  notifyCclFeeRejected,
  createAdminWorkflowTask,
} from "./workflowNotifications.service.js";

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

  const currentStage = resolveCaseStage(caseRecord);
  if (currentStage !== "client_care_letter") {
    await applyCaseStageChange({
      tenantDb,
      caseRecord,
      nextStageId: "client_care_letter",
      performedBy: proposedBy,
      reason: "CCL fees and instalments submitted for admin approval",
      sendEmail: false,
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
  }).catch((err) => console.error("createAdminWorkflowTask:", err));

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
  }).catch((err) => console.error("notifyCclFeeProposed:", err));

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
  if (!ccl || ccl.status !== "fee_proposed") {
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
      await applyCaseStageChange({
        tenantDb,
        caseRecord,
        nextStageId: "client_care_letter",
        performedBy: reviewedBy,
        organisationId,
        reason: reviewNotes || "CCL fee proposal returned to caseworker",
        sendEmail: false,
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
    }).catch((err) => console.error("notifyCclFeeRejected:", err));

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
    await applyCaseStageChange({
      tenantDb,
      caseRecord,
      nextStageId: "client_care_letter",
      performedBy: reviewedBy,
      reason: "CCL fees approved — Client Care Letter released to client",
      sendEmail: true,
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
  await caseRecord.reload();

  await notifyCclFeeApproved({
    tenantDb,
    caseRecord,
    ccl,
    organisationId,
  }).catch((err) => console.error("notifyCclFeeApproved:", err));

  return { ok: true, ccl, caseRecord };
}
