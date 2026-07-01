/**
 * End-of-case actions (candidate visa cases):
 *   - markCaseCompleted:        staff marks an approved case as completed/closed.
 *   - generateCaseClosureLetter: staff generates a branded closure-letter PDF,
 *                                stored as a case Document the candidate + staff
 *                                can download.
 *
 * These are deliberately SEPARATE steps (a case can be completed without a
 * closure letter, and a closure letter can be (re)generated independently).
 */
import fs from "fs";
import path from "path";
import { resolveCaseStage } from "../constants/immigrationCaseProcess.js";
import { getWorkflowState } from "./caseWorkflowProcess.service.js";
import { applyCaseStageChange } from "./caseStageAutomation.service.js";
import { recordTimelineEntry } from "./caseTimeline.service.js";
import {
  notifyUser,
  NotificationTypes,
  NotificationPriority,
} from "./notification.service.js";
import { Op } from "sequelize";
import { generateBrandedPdfBuffer } from "./pdfGenerator.service.js";
import { sendTransactionalEmail } from "./mail.service.js";
import {
  createWorkflowTask,
  getActiveAdminIds,
} from "./workflowTaskAutomation.service.js";
import { resolveOrgPdfLogoDataUri } from "../utils/pdfLogo.js";
import { getOrganisationEmailBranding } from "../utils/emailBranding.js";
import { wrapEpicEmail } from "../utils/epicEmailLayout.js";
import logger from "../utils/logger.js";

/** Document type used for the generated closure letter (also a DECISION_DOC_TYPE). */
export const CASE_CLOSURE_LETTER_TYPE = "Case Closure Letter";

/**
 * Final/decision document types the candidate can receive & download.
 * Keep in sync with DECISION_DOC_TYPES in workflow.controller.js.
 */
export const FINAL_DOCUMENT_TYPES = [
  "Decision Letter",
  "Approval Notice",
  "Visa Copy",
  "BRP Information",
  CASE_CLOSURE_LETTER_TYPE,
];

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

/**
 * Email a case document to the candidate as an attachment (best-effort). Used for
 * final/decision documents and the closure letter so the client receives them by
 * email in addition to being able to download from their account.
 */
export async function emailCaseDocumentToCandidate({
  tenantDb,
  caseRecord,
  document,
  filePath,
  organisationId = null,
}) {
  try {
    if (!caseRecord?.candidateId || !document) return { sent: false };
    const candidate = await tenantDb.User.findByPk(caseRecord.candidateId, {
      attributes: ["id", "first_name", "last_name", "email"],
    });
    if (!candidate?.email) return { sent: false, reason: "no_email" };

    let content;
    try {
      content = fs.readFileSync(filePath || document.documentPath);
    } catch {
      return { sent: false, reason: "file_missing" };
    }

    const branding = await getOrganisationEmailBranding(organisationId);
    const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
    const name =
      [candidate.first_name, candidate.last_name].filter(Boolean).join(" ").trim() ||
      "there";
    const docType = document.documentType || "Document";
    const subject = `${branding.orgName} — ${docType} (${caseLabel})`;

    const html = wrapEpicEmail({
      branding,
      pageTitle: subject,
      badge: "Final Document",
      title: docType,
      messageHtml: `Hi ${name},<br/><br/>Please find attached your <strong>${docType}</strong> for case ${caseLabel}. You can also download it any time from the Final Documents section of your account.`,
      bodyHtml: "",
    });

    return await sendTransactionalEmail({
      organisationId,
      to: candidate.email,
      subject,
      html,
      attachments: [
        {
          filename: document.userFileName || document.documentName || "document",
          content,
          contentType: document.mimeType || "application/pdf",
        },
      ],
      failureContext: `final_document:${docType}`,
    });
  } catch (err) {
    logger.error({ err }, "emailCaseDocumentToCandidate");
    return { sent: false, error: err.message };
  }
}

function decisionIsApproved(caseRecord) {
  const ws = getWorkflowState(caseRecord);
  return String(ws?.decision?.outcome || "").toLowerCase() === "approved";
}

/**
 * Staff: mark an approved case as completed and move it to the closure stage.
 * Guard: only after the decision has been communicated as "approved".
 */
export async function markCaseCompleted({
  tenantDb,
  caseRecord,
  performedBy,
  organisationId = null,
}) {
  if (!tenantDb || !caseRecord) {
    return { ok: false, status: 400, message: "Case not found" };
  }

  const stage = resolveCaseStage(caseRecord);
  if (!["decision_communicated", "case_closure"].includes(stage)) {
    return {
      ok: false,
      status: 400,
      message:
        "A case can only be marked completed after the decision has been communicated to the candidate",
    };
  }
  if (!decisionIsApproved(caseRecord)) {
    return {
      ok: false,
      status: 400,
      message: "Only approved cases can be marked completed",
    };
  }

  if (String(caseRecord.status) === "Closed") {
    return { ok: true, alreadyClosed: true, caseRecord };
  }

  // Advance to the closure stage (fires the case_closure email + candidate task)
  // unless the case is already there.
  if (stage !== "case_closure") {
    await applyCaseStageChange({
      tenantDb,
      caseRecord,
      nextStageId: "case_closure",
      performedBy,
      reason: "Case marked completed by staff after approval",
      organisationId,
    }).catch((err) => logger.error({ err }, "markCaseCompleted: stage change"));
    await caseRecord.reload();
  }

  const updates = { status: "Closed" };
  if ("closed_at" in caseRecord) updates.closed_at = new Date();
  await caseRecord.update(updates).catch(async () => {
    // Fallback if closed_at column is unexpectedly absent.
    await caseRecord.update({ status: "Closed" });
  });

  await recordTimelineEntry({
    tenantDb,
    caseId: caseRecord.id,
    actionType: "case_updated",
    description: "Case marked as completed and closed",
    performedBy,
    visibility: "public",
  }).catch((err) => logger.error({ err }, "markCaseCompleted: timeline"));

  if (caseRecord.candidateId) {
    await notifyUser(tenantDb, caseRecord.candidateId, {
      tenantDb,
      type: NotificationTypes.SUCCESS,
      priority: NotificationPriority.MEDIUM,
      title: `Case completed — ${caseRecord.caseId || `#${caseRecord.id}`}`,
      message:
        "Your case has been completed and closed. You can download your final documents from your account.",
      actionType: "case_completed",
      entityId: caseRecord.id,
      entityType: "case",
      sendEmail: true,
      organisationId,
    }).catch((err) => logger.error({ err }, "markCaseCompleted: notify"));
  }

  return { ok: true, caseRecord };
}

function formatDateGB(d = new Date()) {
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Staff: generate a branded Case Closure Letter PDF and store it as a case
 * Document (visible to the candidate in My Account → Downloads and to staff).
 * Re-generating replaces the previous closure-letter document.
 */
export async function generateCaseClosureLetter({
  tenantDb,
  caseRecord,
  performedBy,
  organisationId = null,
}) {
  if (!tenantDb || !caseRecord) {
    return { ok: false, status: 400, message: "Case not found" };
  }
  if (!tenantDb.Document) {
    return { ok: false, status: 500, message: "Document storage unavailable" };
  }

  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;

  const candidate = caseRecord.candidateId
    ? await tenantDb.User.findByPk(caseRecord.candidateId, {
        attributes: ["id", "first_name", "last_name", "email"],
      })
    : null;
  const clientName =
    [candidate?.first_name, candidate?.last_name].filter(Boolean).join(" ").trim() ||
    "Client";

  const visaType = caseRecord.visaTypeId
    ? await tenantDb.VisaType.findByPk(caseRecord.visaTypeId, {
        attributes: ["id", "name"],
      }).catch(() => null)
    : null;

  const branding = await getOrganisationEmailBranding(organisationId);
  const orgName = branding?.orgName || "your case team";
  const logoDataUri = await resolveOrgPdfLogoDataUri(organisationId);

  const closureDate = formatDateGB();
  const sections = [
    {
      sectionTitle: "Case Closure",
      paragraphs: [
        `Dear ${clientName},`,
        `We are writing to confirm that your immigration case (${caseLabel})${
          visaType?.name ? ` for your ${visaType.name} application` : ""
        } has now been concluded and is formally closed as of ${closureDate}.`,
        `It has been a pleasure assisting you. Copies of your final documents are available to download from your account. Please retain them for your records.`,
        `Should you require any further assistance in the future, please do not hesitate to contact us.`,
        `Kind regards,`,
        orgName,
      ],
      rows: [
        { label: "Case reference", value: caseLabel },
        { label: "Client", value: clientName },
        ...(visaType?.name ? [{ label: "Visa type", value: visaType.name }] : []),
        { label: "Date closed", value: closureDate },
      ],
    },
  ];

  const buffer = await generateBrandedPdfBuffer({
    logoDataUri,
    title: "Case Closure Letter",
    metadata: {
      subtitle: "Confirmation of case closure",
      reference: `Case reference: ${caseLabel}`,
      candidateName: clientName,
    },
    sections,
  });

  // Persist to the case's private storage, mirroring decision-document storage.
  const targetDir = path.join(
    "storage",
    "private",
    "caseimages",
    String(caseRecord.id),
  );
  fs.mkdirSync(targetDir, { recursive: true });
  const systemName = `CASE_CLOSURE_LETTER-${Date.now()}.pdf`;
  const targetPath = path.join(targetDir, systemName);
  fs.writeFileSync(targetPath, buffer);

  const docMeta = {
    documentName: systemName,
    userFileName: `Case_Closure_Letter_${caseLabel}.pdf`,
    documentPath: targetPath,
    documentCategory: "closure",
    mimeType: "application/pdf",
    fileSize: buffer.length,
    uploadedBy: performedBy,
    uploadedAt: new Date(),
    status: "uploaded",
  };

  // Replace an existing closure letter if one was generated before.
  const existing = await tenantDb.Document.findOne({
    where: { caseId: caseRecord.id, documentType: CASE_CLOSURE_LETTER_TYPE },
    order: [["uploadedAt", "DESC"]],
  });

  let document;
  if (existing) {
    if (existing.documentPath && fs.existsSync(existing.documentPath)) {
      try {
        fs.unlinkSync(existing.documentPath);
      } catch {
        /* ignore stale cleanup */
      }
    }
    await existing.update(docMeta);
    document = await existing.reload();
  } else {
    document = await tenantDb.Document.create({
      userId: caseRecord.candidateId ?? performedBy,
      caseId: caseRecord.id,
      documentType: CASE_CLOSURE_LETTER_TYPE,
      ...docMeta,
    });
  }

  await recordTimelineEntry({
    tenantDb,
    caseId: caseRecord.id,
    actionType: "communication_sent",
    description: "Case closure letter generated and shared with the candidate",
    performedBy,
    metadata: { documentId: document.id },
    visibility: "public",
  }).catch((err) => logger.error({ err }, "generateCaseClosureLetter: timeline"));

  if (caseRecord.candidateId) {
    // Email the closure letter as an attachment.
    await emailCaseDocumentToCandidate({
      tenantDb,
      caseRecord,
      document,
      filePath: targetPath,
      organisationId,
    });
    // In-app notification (no duplicate email).
    await notifyUser(tenantDb, caseRecord.candidateId, {
      tenantDb,
      type: NotificationTypes.INFO,
      priority: NotificationPriority.MEDIUM,
      category: "document",
      title: `Case Closure Letter available — ${caseLabel}`,
      message:
        "Your case closure letter has been emailed to you and is available to download from your account.",
      entityType: "document",
      entityId: document.id,
      actionType: "case_closure_letter",
      actionUrl: "/my-account?tab=downloads",
      sendEmail: false,
      organisationId,
    }).catch((err) => logger.error({ err }, "generateCaseClosureLetter: notify"));
  }

  return {
    ok: true,
    document: {
      id: document.id,
      documentType: document.documentType,
      userFileName: document.userFileName,
      uploadedAt: document.uploadedAt,
    },
  };
}

/**
 * Candidate: request their final documents. Notifies the assigned caseworker(s)
 * (and admins as a fallback) and creates a follow-up task.
 */
export async function requestFinalDocuments({
  tenantDb,
  caseRecord,
  requestedBy,
  organisationId = null,
}) {
  if (!tenantDb || !caseRecord) {
    return { ok: false, status: 400, message: "Case not found" };
  }

  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
  let recipientIds = parseCaseworkerIds(caseRecord);
  if (!recipientIds.length) {
    recipientIds = await getActiveAdminIds(tenantDb).catch(() => []);
  }

  let notified = 0;
  for (const staffId of recipientIds) {
    const task = await createWorkflowTask({
      tenantDb,
      caseRecord,
      assigneeId: staffId,
      title: `Send final documents to client — ${caseLabel}`,
      createdBy: requestedBy || staffId,
      priority: "high",
      dueInDays: 2,
      organisationId,
    }).catch((err) => {
      logger.error({ err }, "requestFinalDocuments: task");
      return null;
    });
    if (task) notified += 1;
  }

  await recordTimelineEntry({
    tenantDb,
    caseId: caseRecord.id,
    actionType: "case_updated",
    description: "Candidate requested their final documents",
    performedBy: requestedBy,
    visibility: "public",
  }).catch((err) => logger.error({ err }, "requestFinalDocuments: timeline"));

  return { ok: true, notified };
}

/**
 * Staff: re-send (email) all of the candidate's final documents as attachments.
 */
export async function resendFinalDocuments({
  tenantDb,
  caseRecord,
  performedBy,
  organisationId = null,
}) {
  if (!tenantDb || !caseRecord) {
    return { ok: false, status: 400, message: "Case not found" };
  }
  if (!caseRecord.candidateId) {
    return { ok: false, status: 400, message: "This case has no candidate to send to" };
  }

  const docs = await tenantDb.Document.findAll({
    where: {
      caseId: caseRecord.id,
      documentType: { [Op.in]: FINAL_DOCUMENT_TYPES },
      status: { [Op.in]: ["uploaded", "approved"] },
    },
    order: [["created_at", "DESC"]],
  });

  if (!docs.length) {
    return {
      ok: false,
      status: 400,
      message: "No final documents have been uploaded for this case yet",
    };
  }

  let sent = 0;
  for (const document of docs) {
    const result = await emailCaseDocumentToCandidate({
      tenantDb,
      caseRecord,
      document,
      filePath: document.documentPath,
      organisationId,
    });
    if (result?.sent) sent += 1;
  }

  await recordTimelineEntry({
    tenantDb,
    caseId: caseRecord.id,
    actionType: "communication_sent",
    description: `Final documents re-sent to the candidate (${sent}/${docs.length})`,
    performedBy,
    visibility: "public",
  }).catch((err) => logger.error({ err }, "resendFinalDocuments: timeline"));

  return { ok: true, sent, total: docs.length };
}
