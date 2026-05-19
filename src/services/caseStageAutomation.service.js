import {
  resolveCaseStage,
  getStepById,
  normalizeCaseStage,
  STAGE_TO_LEGACY_STATUS,
} from "../constants/immigrationCaseProcess.js";
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
  const byType = new Map(docs.map((d) => [d.documentType, d]));

  let hasRejected = false;
  let allApproved = true;
  let complete = true;

  for (const item of checklist) {
    const doc = byType.get(item.documentType);
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
      });
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
      return applyCaseStageChange({
        tenantDb,
        caseRecord,
        nextStageId: "application_preparation",
        performedBy,
        reason: "Mandatory documents received — application preparation started",
        organisationId,
      });
    }

    if (["document_review", "application_preparation"].includes(currentStage) && checklist.allApproved) {
      return applyCaseStageChange({
        tenantDb,
        caseRecord,
        nextStageId: "draft_application_review",
        performedBy,
        reason: "All required documents approved — draft review",
        organisationId,
      });
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
