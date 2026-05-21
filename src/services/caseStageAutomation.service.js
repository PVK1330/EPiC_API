import {
  resolveCaseStage,
  getStepById,
  normalizeCaseStage,
  STAGE_TO_LEGACY_STATUS,
} from "../constants/immigrationCaseProcess.js";
import {
  buildDocumentLookupMap,
  findDocumentForChecklistItem,
} from "../utils/documentMatch.utils.js";
import { recordStatusChange, recordTimelineEntry } from "./caseTimeline.service.js";
import { sendWorkflowStageEmail } from "./workflowEmail.service.js";
import { notifyWorkflowStageChange } from "./workflowNotifications.service.js";
import { syncWorkflowTasksForStage } from "./workflowTaskAutomation.service.js";

const UPLOADED_STATUSES = new Set(["uploaded", "under_review", "approved"]);

async function getRequiredChecklistStatus(tenantDb, caseRecord) {
  if (!caseRecord?.visaTypeId) return { complete: false, hasRejected: false, allApproved: false };

  const checklist = await tenantDb.DocumentChecklist.findAll({
    where: { visaTypeId: caseRecord.visaTypeId, isRequired: true },
  });
  if (!checklist.length) return { complete: true, hasRejected: false, allApproved: true };

  const docs = await tenantDb.Document.findAll({
    where: { caseId: caseRecord.id },
  });

  const candidateId = caseRecord.candidateId;
  if (candidateId) {
    const orphanDocs = await tenantDb.Document.findAll({
      where: { userId: candidateId, caseId: null },
    });
    docs.push(...orphanDocs);
  }

  const docLookup = buildDocumentLookupMap(docs);

  let hasRejected = false;
  let allApproved = true;
  let complete = true;

  for (const item of checklist) {
    const doc = findDocumentForChecklistItem(item, docLookup);
    if (!doc || !UPLOADED_STATUSES.has(doc.status)) {
      complete = false;
      allApproved = false;
    } else if (doc.status === "rejected") {
      hasRejected = true;
      complete = false;
      allApproved = false;
    } else if (doc.status !== "approved") {
      allApproved = false;
    }
  }

  return { complete, hasRejected, allApproved };
}

export async function applyCaseStageChange({
  tenantDb,
  caseRecord,
  nextStageId,
  performedBy,
  reason,
  sendEmail = true,
  organisationId = null,
}) {
  const previousStage = resolveCaseStage(caseRecord);
  const nextStage = normalizeCaseStage(nextStageId);
  if (!nextStage || previousStage === nextStage) return null;

  const prevStep = getStepById(previousStage);
  const nextStep = getStepById(nextStage);
  const legacyStatus = STAGE_TO_LEGACY_STATUS[nextStage] || caseRecord.status;

  await caseRecord.update({
    caseStage: nextStage,
    status: legacyStatus,
  });

  await recordStatusChange({
    tenantDb,
    caseId: caseRecord.id,
    performedBy,
    previousValue: prevStep?.title || previousStage,
    newValue: nextStep?.title || nextStage,
    description: reason || `Workflow advanced to: ${nextStep?.title || nextStage}`,
    isSystemAction: true,
  });

  if (sendEmail) {
    try {
      const emailResult = await sendWorkflowStageEmail({
        tenantDb,
        caseRecord,
        stageId: nextStage,
        organisationId,
      });
      if (emailResult?.sent) {
        await recordTimelineEntry({
          tenantDb,
          caseId: caseRecord.id,
          actionType: "communication_sent",
          description: `Workflow email sent (${emailResult.templateKey})`,
          performedBy,
          metadata: {
            templateKey: emailResult.templateKey,
            recipientEmail: emailResult.to,
            emailSent: true,
          },
          visibility: "internal",
        }).catch((err) => console.error("recordTimelineEntry (email):", err));
      }
    } catch (emailErr) {
      console.error("sendWorkflowStageEmail failed (stage change continues):", emailErr);
    }
  }

  await notifyWorkflowStageChange({
    tenantDb,
    caseRecord,
    previousStage,
    nextStage,
    performedBy,
    organisationId,
  }).catch((err) => console.error("notifyWorkflowStageChange:", err));

  await syncWorkflowTasksForStage({
    tenantDb,
    caseRecord,
    stageId: nextStage,
    performedBy,
    organisationId,
  }).catch((err) => console.error("syncWorkflowTasksForStage:", err));

  const { runStageEntryHooks } = await import("./caseWorkflowExtended.service.js");
  await runStageEntryHooks({
    tenantDb,
    caseRecord,
    nextStage,
    performedBy,
    organisationId,
  }).catch((err) => console.error("runStageEntryHooks:", err));

  return { previousStage, nextStage };
}

/**
 * Evaluates doc/payment events and advances caseStage when rules match (forward-only).
 */
export async function evaluateCaseStageAfterEvent({
  tenantDb,
  caseRecord,
  trigger,
  performedBy = null,
  organisationId = null,
}) {
  if (!tenantDb || !caseRecord) return null;

  const currentStage = resolveCaseStage(caseRecord);
  const checklist = await getRequiredChecklistStatus(tenantDb, caseRecord);

  // Auto-mark CCL payment received (legacy stage id) when signed/accepted and fully paid
  if (trigger === "payment_received" && currentStage === "client_care_letter") {
    const ccl = await tenantDb.CaseCclRecord?.findOne({ where: { caseId: caseRecord.id } });
    const cclSigned = ccl && (ccl.status === "signed" || ccl.status === "accepted");
    const amountStatus = String(caseRecord.amountStatus || "").toLowerCase();
    const fullyPaid =
      amountStatus === "paid" ||
      (Number(caseRecord.totalAmount) > 0 &&
        Number(caseRecord.paidAmount) >= Number(caseRecord.totalAmount));

    if (cclSigned && fullyPaid && caseRecord.caseStage !== "ccl_payment_received") {
      const result = await applyCaseStageChange({
        tenantDb,
        caseRecord,
        nextStageId: "ccl_payment_received",
        performedBy,
        reason: "Client Care Letter accepted and payment fully received",
        organisationId,
      });

      if (!result) {
        await caseRecord.update({ caseStage: "ccl_payment_received" });
        await recordTimelineEntry({
          tenantDb,
          caseId: caseRecord.id,
          actionType: "status_change",
          description: "CCL payment received — ready for visa portal submission",
          performedBy,
          visibility: "internal",
        });
        await caseRecord.reload();
        await syncWorkflowTasksForStage({
          tenantDb,
          caseRecord,
          stageId: "ccl_payment_received",
          performedBy,
          organisationId,
        }).catch((err) => console.error("syncWorkflowTasksForStage:", err));
        return { previousStage: currentStage, nextStage: "client_care_letter", legacyStage: "ccl_payment_received" };
      }
      return result;
    }
  }

  if (trigger === "document_rejected" && ["document_review", "application_preparation", "data_capture_initial_docs"].includes(currentStage)) {
    if (currentStage !== "further_information_request") {
      return applyCaseStageChange({
        tenantDb,
        caseRecord,
        nextStageId: "further_information_request",
        performedBy,
        reason: "Further information required — document rejected",
        organisationId,
      });
    }
    return null;
  }

  if (trigger === "document_reviewed" || trigger === "document_uploaded") {
    if (currentStage === "data_capture_initial_docs" && checklist.complete && !checklist.hasRejected) {
      await applyCaseStageChange({
        tenantDb,
        caseRecord,
        nextStageId: "application_preparation",
        performedBy,
        reason: "Mandatory documents received — application preparation started",
        organisationId,
      });
      await caseRecord.reload();
    }

    if (checklist.allApproved && !checklist.hasRejected) {
      const stageAfterUpload = resolveCaseStage(caseRecord);
      const draftStep = getStepById("draft_application_review");
      const currentStep = getStepById(stageAfterUpload);

      if (
        currentStep &&
        draftStep &&
        currentStep.order < draftStep.order &&
        ["data_capture_initial_docs", "application_preparation", "document_review"].includes(
          stageAfterUpload,
        )
      ) {
        if (stageAfterUpload === "data_capture_initial_docs") {
          await applyCaseStageChange({
            tenantDb,
            caseRecord,
            nextStageId: "application_preparation",
            performedBy,
            reason: "Required documents approved — application preparation",
            organisationId,
            sendEmail: false,
          });
          await caseRecord.reload();
        }

        return applyCaseStageChange({
          tenantDb,
          caseRecord,
          nextStageId: "draft_application_review",
          performedBy,
          reason: "All required documents approved — draft application review",
          organisationId,
        });
      }
    }
  }

  return null;
}

export async function recordDocumentReviewTimeline({ tenantDb, caseRecord, document, status, performedBy }) {
  if (!tenantDb || !caseRecord) return;
  await recordTimelineEntry({
    tenantDb,
    caseId: caseRecord.id,
    actionType: "document_reviewed",
    description: `Document "${document.userFileName || document.documentName}" ${status}`,
    performedBy,
    previousValue: null,
    newValue: status,
    metadata: { documentId: document.id, documentType: document.documentType },
    visibility: "public",
  });
}
