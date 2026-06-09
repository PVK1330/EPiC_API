import { getStepById, resolveCaseStage } from "../constants/immigrationCaseProcess.js";
import { applyCaseStageChange } from "./caseStageAutomation.service.js";
import {
  attachCclTemplateToCase,
  CCL_VISIBLE_MIN_ORDER,
  isCclStageVisibleToCandidate,
} from "./cclTemplate.service.js";
import logger from "../utils/logger.js";

const RELEASED_CCL_STATUSES = new Set(["issued", "signed", "accepted"]);

function normaliseAmountStatus(status) {
  return String(status || "").trim();
}

export function isFeesApprovedForClient(caseRecord) {
  const s = normaliseAmountStatus(caseRecord?.amountStatus);
  return ["Approved", "Paid", "approved", "paid"].includes(s);
}

/** Resolve payable total from case row, admin CCL fee (proposedAmount), and/or CCL record. */
export function resolveCaseFeeTotal(caseRecord, ccl) {
  const fromCase = Number(caseRecord?.totalAmount);
  const fromCcl = Number(ccl?.feeAmount);
  const fromAdminCcl = Number(caseRecord?.proposedAmount);
  if (Number.isFinite(fromCase) && fromCase > 0) return fromCase;
  if (Number.isFinite(fromCcl) && fromCcl > 0) return fromCcl;
  if (Number.isFinite(fromAdminCcl) && fromAdminCcl > 0) return fromAdminCcl;
  const plan = ccl?.installmentPlan;
  if (Array.isArray(plan) && plan.length > 0) {
    return plan.reduce((sum, row) => sum + (Number.parseFloat(row.amount) || 0), 0);
  }
  return 0;
}

/**
 * Whether the candidate may view CCL summary and payment schedule.
 * Covers full workflow (ccl.status issued) and legacy admin-only amountStatus approval.
 */
export function isCclReleasedToClient(caseRecord, ccl) {
  if (!caseRecord) return false;

  const cclStatus = String(ccl?.status || "").toLowerCase();
  if (RELEASED_CCL_STATUSES.has(cclStatus)) return true;

  if (isCclStageVisibleToCandidate(caseRecord)) return true;

  if (isFeesApprovedForClient(caseRecord)) {
    if (resolveCaseFeeTotal(caseRecord, ccl) > 0) return true;
    if (RELEASED_CCL_STATUSES.has(cclStatus)) return true;
    if (cclStatus === "fee_proposed") return true;
  }

  const step = getStepById(resolveCaseStage(caseRecord));
  return (step?.order ?? 0) >= CCL_VISIBLE_MIN_ORDER;
}

/**
 * When fees are admin-approved but CCL row / stage were not updated (legacy finance PATCH),
 * sync so candidate APIs and accept flow work.
 */
export async function syncCclReleaseForApprovedFees({
  tenantDb,
  caseRecord,
  performedBy = null,
  organisationId = null,
}) {
  if (!tenantDb?.CaseCclRecord || !caseRecord) return { ccl: null, caseRecord, synced: false };

  if (!isFeesApprovedForClient(caseRecord)) {
    return { ccl: null, caseRecord, synced: false };
  }

  let ccl = await tenantDb.CaseCclRecord.findOne({ where: { caseId: caseRecord.id } });
  let fee = resolveCaseFeeTotal(caseRecord, ccl);

  if (fee <= 0) {
    return { ccl, caseRecord, synced: false };
  }

  let synced = false;

  if (Number(caseRecord.totalAmount) <= 0 || !caseRecord.totalAmount) {
    await caseRecord.update({ totalAmount: fee });
    synced = true;
  }

  if (!ccl) {
    [ccl] = await tenantDb.CaseCclRecord.findOrCreate({
      where: { caseId: caseRecord.id },
      defaults: {
        status: "issued",
        feeAmount: fee,
        installmentPlan: [{ label: "Full fee", amount: fee, dueDate: null }],
        issuedAt: new Date(),
        issuedBy: performedBy,
      },
    });
    synced = true;
  } else if (!RELEASED_CCL_STATUSES.has(String(ccl.status || "").toLowerCase())) {
    const plan =
      Array.isArray(ccl.installmentPlan) && ccl.installmentPlan.length > 0
        ? ccl.installmentPlan
        : [{ label: "Full fee", amount: Number(ccl.feeAmount) || fee, dueDate: null }];

    await ccl.update({
      status: "issued",
      feeAmount: Number(ccl.feeAmount) || fee,
      installmentPlan: plan,
      issuedAt: ccl.issuedAt || new Date(),
      issuedBy: ccl.issuedBy || performedBy,
      adminReviewedAt: ccl.adminReviewedAt || new Date(),
      adminReviewedBy: ccl.adminReviewedBy || performedBy,
    });
    synced = true;
  }

  const stage = resolveCaseStage(caseRecord);
  if (!["ccl_issued", "ccl_payment_received"].includes(stage)) {
    await applyCaseStageChange({
      tenantDb,
      caseRecord,
      nextStageId: "ccl_issued",
      performedBy,
      organisationId,
      reason: "CCL fees approved — released to client",
      sendEmail: false,
    });
    synced = true;
  }

  if (synced) {
    await Promise.all([caseRecord.reload(), ccl.reload()]);
  }

  if (isCclReleasedToClient(caseRecord, ccl) && !ccl.issuedDocumentId) {
    await attachCclTemplateToCase({
      tenantDb,
      caseRecord,
      ccl,
      performedBy,
    }).catch((err) => logger.error({ err }, "attachCclTemplateToCase"));
    await ccl.reload();
  }

  return { ccl, caseRecord, synced };
}
