import { Op } from "sequelize";
import {
  resolveCaseStage,
  STAGE_TO_LEGACY_STATUS,
  getStageOrder,
} from "../../../constants/immigrationCaseProcess.js";
import { applyCaseStageChange } from "../../../services/caseStageAutomation.service.js";
import { sendWorkflowStageEmail } from "../../../services/workflowEmail.service.js";
import {
  buildDataCaptureSheetPdfAttachment,
  resolveRequiredDocuments,
  formatRequiredDocumentsText,
} from "../../../services/dataCaptureSheet.service.js";
import { getOrganisationEmailBranding } from "../../../utils/emailBranding.js";
import { recordTimelineEntry } from "../../../services/caseTimeline.service.js";
import { ROLES } from "../../../middlewares/role.middleware.js";
import {
  notifyCclFeeProposed,
  notifyCclFeeApproved,
  notifyCclFeeRejected,
} from "../../../services/workflowNotifications.service.js";
import {
  createTasksOnDataCaptureSent,
  createTasksOnDataCaptureRejected,
} from "../../../services/workflowTaskAutomation.service.js";
import {
  getWorkflowState,
  submitDraftReviewDecision,
  recordVisaPortalSubmission,
  submitBiometricAvailability,
  sendBiometricSlotToCandidate,
  bookBiometricDirect,
  recordBiometricDocumentsUploaded,
  recordVisaPortalReply,
  markBiometricAttendedByCandidate,
  hasBiometricAppointmentBooked,
  communicateDecision,
} from "../../../services/caseWorkflowProcess.service.js";
import {
  submitCclFeeProposal,
  reviewCclFeeProposal,
  sendCclPaymentRequest,
} from "../../../services/cclFeeProposal.service.js";
import {
  markCaseCompleted,
  generateCaseClosureLetter,
  emailCaseDocumentToCandidate,
  requestFinalDocuments,
  resendFinalDocuments,
} from "../../../services/caseClosure.service.js";
import {
  isCclReleasedToClient,
  resolveCaseFeeTotal,
  syncCclReleaseForApprovedFees,
} from "../../../services/cclCandidateRelease.service.js";
import {
  attachCclTemplateToCase,
  isCclStageVisibleToCandidate,
  resolveCclTemplate,
} from "../../../services/cclTemplate.service.js";
import path from "path";
import fs from "fs";
import { buildCandidateCclApprovalTimeline } from "../../../utils/cclApprovalTimeline.utils.js";
import logger from '../../../utils/logger.js';
import { notifyUser, NotificationTypes, NotificationPriority } from '../../../services/notification.service.js';

function organisationIdFromReq(req) {
  const id = req.user?.organisation_id;
  return id != null ? Number(id) : null;
}

async function resolveUserTimezone(tenantDb, userId) {
  if (!tenantDb || !userId) return "UTC";
  const sponsorPref = tenantDb.SponsorUserPreference
    ? await tenantDb.SponsorUserPreference.findOne({
        where: { userId },
        attributes: ["timezone"],
      })
    : null;
  const sponsorTz = sponsorPref?.timezone
    ? String(sponsorPref.timezone).trim()
    : "";
  if (sponsorTz) return sponsorTz;

  const adminPref = tenantDb.AdminUserPreference
    ? await tenantDb.AdminUserPreference.findOne({
        where: { user_id: userId },
        attributes: ["timezone"],
      })
    : null;
  const adminTz = adminPref?.timezone ? String(adminPref.timezone).trim() : "";
  return adminTz || "UTC";
}

function normalizeInstallments(installments = []) {
  if (!Array.isArray(installments)) return [];
  return installments.map((row, i) => ({
    label: String(row.label || `Instalment ${i + 1}`).trim(),
    amount: Number.parseFloat(row.amount) || 0,
    dueDate: row.dueDate || null,
  }));
}

function validateInstallmentPlan(total, installments) {
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

const DECISION_DOC_TYPES = [
  "Decision Letter",
  "Approval Notice",
  "Visa Copy",
  "BRP Information",
  "Case Closure Letter",
];

async function findCaseForUser(tenantDb, userId) {
  return tenantDb.Case.findOne({
    where: { candidateId: userId },
    order: [["created_at", "DESC"]],
    include: [
      { model: tenantDb.VisaType, as: "visaType", attributes: ["id", "name"] },
    ],
  });
}

async function findCaseByRef(tenantDb, caseRef) {
  if (!caseRef) return null;
  const numeric = parseInt(caseRef, 10);
  return (
    (await tenantDb.Case.findOne({ where: { caseId: String(caseRef) } })) ||
    (!Number.isNaN(numeric) ? await tenantDb.Case.findByPk(numeric) : null)
  );
}

async function resolveTemplate(tenantDb, visaTypeId) {
  if (visaTypeId) {
    const specific = await tenantDb.DataCaptureTemplate.findOne({
      where: { visaTypeId, isActive: true },
      order: [["id", "DESC"]],
    });
    if (specific) return specific;
  }
  return tenantDb.DataCaptureTemplate.findOne({
    where: { visaTypeId: { [Op.is]: null }, isActive: true },
    order: [["id", "DESC"]],
  });
}

/** GET candidate data capture form */
export const getDataCaptureForm = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const caseRecord = await findCaseForUser(req.tenantDb, userId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "No case found", data: null });
    }

    const template = await resolveTemplate(req.tenantDb, caseRecord.visaTypeId);
    let submission = await req.tenantDb.DataCaptureSubmission.findOne({
      where: { caseId: caseRecord.id },
    });

    if (!submission && template) {
      submission = await req.tenantDb.DataCaptureSubmission.create({
        caseId: caseRecord.id,
        userId,
        templateId: template.id,
        responses: {},
        status: "draft",
      });
    }

    res.status(200).json({
      status: "success",
      data: {
        case: {
          id: caseRecord.id,
          caseId: caseRecord.caseId,
          caseStage: caseRecord.caseStage,
        },
        template: template
          ? { id: template.id, name: template.name, fields: template.fields }
          : null,
        submission: submission?.toJSON() ?? null,
      },
    });
  } catch (err) {
    logger.error({ err }, "getDataCaptureForm");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** POST submit data capture (alias) */
export const submitDataCapture = async (req, res) => {
  req.body = { ...req.body, submit: true };
  return saveDataCaptureSubmission(req, res);
};

/** PUT save draft / POST submit data capture */
export const saveDataCaptureSubmission = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { responses, submit } = req.body;
    const caseRecord = await findCaseForUser(req.tenantDb, userId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "No case found", data: null });
    }

    let submission = await req.tenantDb.DataCaptureSubmission.findOne({
      where: { caseId: caseRecord.id },
    });
    if (!submission) {
      const template = await resolveTemplate(
        req.tenantDb,
        caseRecord.visaTypeId,
      );
      submission = await req.tenantDb.DataCaptureSubmission.create({
        caseId: caseRecord.id,
        userId,
        templateId: template?.id,
        responses: responses || {},
        status: submit ? "submitted" : "draft",
        submittedAt: submit ? new Date() : null,
      });
    } else {
      if (submission.status === "approved") {
        return res.status(400).json({
          status: "error",
          message: "Submission already approved",
          data: null,
        });
      }
      await submission.update({
        responses: responses ?? submission.responses,
        status: submit ? "submitted" : submission.status,
        submittedAt: submit ? new Date() : submission.submittedAt,
      });
    }

    if (submit) {
      await recordTimelineEntry({
        tenantDb: req.tenantDb,
        caseId: caseRecord.id,
        actionType: "case_updated",
        description: "Data Capture Sheet submitted by client",
        performedBy: userId,
        visibility: "public",
      });

      await caseRecord.reload();
      const currentStage = resolveCaseStage(caseRecord);
      if (currentStage === "data_capture_initial_docs") {
        try {
          await applyCaseStageChange({
            tenantDb: req.tenantDb,
            caseRecord,
            nextStageId: "application_preparation",
            performedBy: userId,
            organisationId: organisationIdFromReq(req),
            reason:
              "Data Capture Sheet submitted by client — application preparation started",
            sendEmail: false,
          });
          await caseRecord.reload();
        } catch (stageErr) {
          logger.error({ err: stageErr }, "DCS submit stage automation");
        }
      }
    }

    res.status(200).json({
      status: "success",
      message: submit ? "Data Capture Sheet submitted" : "Draft saved",
      data: { submission },
    });
  } catch (err) {
    logger.error({ err }, "saveDataCaptureSubmission");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Staff: fetch data capture sheet for a case */
export const getStaffDataCapture = async (req, res) => {
  try {
    const caseRecord = await findCaseByRef(req.tenantDb, req.params.caseId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Case not found", data: null });
    }
    const template = await resolveTemplate(req.tenantDb, caseRecord.visaTypeId);
    const submission = await req.tenantDb.DataCaptureSubmission.findOne({
      where: { caseId: caseRecord.id },
    });
    res.status(200).json({
      status: "success",
      data: {
        fields: template?.fields || [],
        template,
        submission,
        status: submission?.status || "not_started",
        candidateResponse: submission?.responses || null,
      },
    });
  } catch (err) {
    logger.error({ err }, "getStaffDataCapture");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Caseworker: send DCS request + email + set stage */
export const sendDataCaptureRequest = async (req, res) => {
  try {
    const { caseId } = req.params;
    const caseRecord = await findCaseByRef(req.tenantDb, caseId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Case not found", data: null });
    }

    const template = await resolveTemplate(req.tenantDb, caseRecord.visaTypeId);
    const [submission] = await req.tenantDb.DataCaptureSubmission.findOrCreate({
      where: { caseId: caseRecord.id },
      defaults: {
        userId: caseRecord.candidateId,
        templateId: template?.id,
        responses: {},
        status: "draft",
      },
    });

    await caseRecord.update({
      caseStage: "data_capture_initial_docs",
      status: STAGE_TO_LEGACY_STATUS.data_capture_initial_docs,
    });

    const candidate = caseRecord.candidateId
      ? await req.tenantDb.User.findByPk(caseRecord.candidateId, {
          attributes: ["id", "first_name", "last_name", "email"],
        })
      : null;

    const visaType = caseRecord.visaTypeId
      ? await req.tenantDb.VisaType.findByPk(caseRecord.visaTypeId, {
          attributes: ["id", "name"],
        })
      : null;

    const requiredDocuments = await resolveRequiredDocuments(
      req.tenantDb,
      caseRecord,
    );

    // Resolve org branding so the PDF carries the org's (or superadmin's) logo
    // rather than the hardcoded fallback asset.
    const branding = await getOrganisationEmailBranding(
      organisationIdFromReq(req),
    );

    const sheetAttachment = await buildDataCaptureSheetPdfAttachment({
      template,
      caseRecord,
      candidate,
      visaTypeName: visaType?.name || "",
      requiredDocuments,
      branding,
    }).catch((err) => {
      logger.error({ err }, "buildDataCaptureSheetPdfAttachment");
      return null;
    });

    const emailAttachments = sheetAttachment ? [sheetAttachment] : null;
    const requiredDocsText = formatRequiredDocumentsText(requiredDocuments);

    const emailResult = await sendWorkflowStageEmail({
      tenantDb: req.tenantDb,
      caseRecord,
      stageId: "data_capture_initial_docs",
      organisationId: organisationIdFromReq(req),
      attachments: emailAttachments,
      extraVars: requiredDocsText ? { required_documents: requiredDocsText } : null,
    });

    await recordTimelineEntry({
      tenantDb: req.tenantDb,
      caseId: caseRecord.id,
      actionType: "communication_sent",
      description: "Data Capture Sheet request sent to client",
      performedBy: req.user?.userId,
      metadata: {
        emailSent: emailResult.sent,
        attachmentIncluded: Boolean(sheetAttachment),
        attachmentFilename: sheetAttachment?.filename || null,
      },
      visibility: "public",
    });

    await createTasksOnDataCaptureSent({
      tenantDb: req.tenantDb,
      caseRecord,
      sentBy: req.user?.userId,
      organisationId: organisationIdFromReq(req),
    }).catch((err) => logger.error({ err }, "createTasksOnDataCaptureSent"));

    res.status(200).json({
      status: "success",
      message: "Data Capture request sent",
      data: { case: caseRecord, submission, email: emailResult },
    });
  } catch (err) {
    logger.error({ err }, "sendDataCaptureRequest");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Caseworker/Admin: request further information/documents from the client. */
export const sendFurtherInformationRequest = async (req, res) => {
  try {
    const { caseId } = req.params;
    const caseRecord = await findCaseByRef(req.tenantDb, caseId);
    if (!caseRecord) {
      return res.status(404).json({ status: "error", message: "Case not found", data: null });
    }

    const items = Array.isArray(req.body?.items)
      ? req.body.items.map((i) => String(i).trim()).filter(Boolean)
      : [];
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    let requestedItems;
    if (items.length) requestedItems = items.map((i) => `- ${i}`).join("\n");
    else if (message) requestedItems = message;
    else requestedItems = "- Please contact us / see the portal for details.";

    // Move to further_information_request (this also creates the candidate task).
    await applyCaseStageChange({
      tenantDb: req.tenantDb,
      caseRecord,
      nextStageId: "further_information_request",
      performedBy: req.user?.userId,
      reason: "Further information requested from client",
      sendEmail: false, // a richer email with the requested items is sent below
      organisationId: organisationIdFromReq(req),
    }).catch((err) => logger.error({ err }, "applyCaseStageChange (further info)"));

    const emailResult = await sendWorkflowStageEmail({
      tenantDb: req.tenantDb,
      caseRecord,
      stageId: "further_information_request",
      organisationId: organisationIdFromReq(req),
      extraVars: { requested_items: requestedItems },
    });

    await recordTimelineEntry({
      tenantDb: req.tenantDb,
      caseId: caseRecord.id,
      actionType: "communication_sent",
      description: "Further information requested from client",
      performedBy: req.user?.userId,
      metadata: { items, message, emailSent: emailResult.sent },
      visibility: "public",
    });

    res.status(200).json({
      status: "success",
      message: "Further information request sent",
      data: { email: emailResult },
    });
  } catch (err) {
    logger.error({ err }, "sendFurtherInformationRequest");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Caseworker/Admin: send the draft application to the client for review. */
export const sendDraftApplicationForReview = async (req, res) => {
  try {
    const { caseId } = req.params;
    const caseRecord = await findCaseByRef(req.tenantDb, caseId);
    if (!caseRecord) {
      return res.status(404).json({ status: "error", message: "Case not found", data: null });
    }

    // Moving to draft_application_review locks the candidate's form to read-only,
    // creates the candidate review task, and emails them (draft_application_review
    // template). The candidate reviews the draft in the portal and confirms.
    await applyCaseStageChange({
      tenantDb: req.tenantDb,
      caseRecord,
      nextStageId: "draft_application_review",
      performedBy: req.user?.userId,
      reason: "Draft application sent to client for review",
      sendEmail: true,
      organisationId: organisationIdFromReq(req),
    });

    await recordTimelineEntry({
      tenantDb: req.tenantDb,
      caseId: caseRecord.id,
      actionType: "communication_sent",
      description: "Draft application sent to client for review",
      performedBy: req.user?.userId,
      visibility: "public",
    });

    res.status(200).json({
      status: "success",
      message: "Draft application sent to the client for review",
      data: null,
    });
  } catch (err) {
    logger.error({ err }, "sendDraftApplicationForReview");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Caseworker: review DCS submission */
export const reviewDataCaptureSubmission = async (req, res) => {
  try {
    const { caseId } = req.params;
    const { status, reviewNotes } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        status: "error",
        message: "status must be approved or rejected",
        data: null,
      });
    }

    const caseRecord = await findCaseByRef(req.tenantDb, caseId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Case not found", data: null });
    }

    const submission = await req.tenantDb.DataCaptureSubmission.findOne({
      where: { caseId: caseRecord.id },
    });
    if (!submission) {
      return res
        .status(404)
        .json({ status: "error", message: "No submission found", data: null });
    }

    await submission.update({ status, reviewNotes: reviewNotes || null });

    if (status === "approved") {
      // Mark "Complete Data Capture Sheet" task as completed
      await req.tenantDb.Task.update(
        { status: "completed" },
        {
          where: {
            case_id: caseRecord.id,
            status: "pending",
            title: {
              [req.tenantDb.Sequelize.Op.iLike]:
                "%Complete Data Capture Sheet%",
            },
            assigned_to: caseRecord.candidateId,
          },
        },
      ).catch((err) => logger.error({ err }, "Failed to mark DCS task complete"));

      await applyCaseStageChange({
        tenantDb: req.tenantDb,
        caseRecord,
        nextStageId: "application_preparation",
        performedBy: req.user?.userId,
        organisationId: organisationIdFromReq(req),
        reason: "Data Capture Sheet approved",
        sendEmail: false,
      });
    } else if (status === "rejected") {
      await createTasksOnDataCaptureRejected({
        tenantDb: req.tenantDb,
        caseRecord,
        reviewNotes,
        reviewedBy: req.user?.userId,
        organisationId: organisationIdFromReq(req),
      }).catch((err) =>
        logger.error({ err }, "createTasksOnDataCaptureRejected"),
      );
    }

    res.status(200).json({ status: "success", data: { submission } });
  } catch (err) {
    logger.error({ err }, "reviewDataCaptureSubmission");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Caseworker: propose CCL fees + instalments (admin must approve before client sees CCL) */
export const proposeCclFees = async (req, res) => {
  try {
    const { caseId } = req.params;
    const { feeAmount, installments, notes, documentId } = req.body;
    const caseRecord = await findCaseByRef(req.tenantDb, caseId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Case not found", data: null });
    }

    const result = await submitCclFeeProposal({
      tenantDb: req.tenantDb,
      caseRecord,
      feeAmount,
      installments,
      notes,
      proposedBy: req.user?.userId,
      organisationId: organisationIdFromReq(req),
      documentId,
      allowFromAnyStage: true,
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        status: "error",
        message: result.message,
        data: null,
      });
    }

    res.status(200).json({
      status: "success",
      message: "Fee proposal submitted for admin approval",
      data: { ccl: result.ccl, case: result.caseRecord },
    });
  } catch (err) {
    logger.error({ err }, "proposeCclFees");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Admin: approve or reject proposed CCL fees */
export const reviewCclFees = async (req, res) => {
  try {
    if (
      Number(req.user?.role_id) !== ROLES.ADMIN &&
      Number(req.user?.role) !== ROLES.ADMIN
    ) {
      return res.status(403).json({
        status: "error",
        message: "Admin access required",
        data: null,
      });
    }

    const { caseId } = req.params;
    const { action, reviewNotes } = req.body;
    const caseRecord = await findCaseByRef(req.tenantDb, caseId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Case not found", data: null });
    }

    const result = await reviewCclFeeProposal({
      tenantDb: req.tenantDb,
      caseRecord,
      action,
      reviewNotes,
      reviewedBy: req.user?.userId,
      organisationId: organisationIdFromReq(req),
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        status: "error",
        message: result.message,
        data: null,
      });
    }

    res.status(200).json({
      status: "success",
      message:
        action === "reject"
          ? "Fee proposal returned to caseworker"
          : "Fees approved and CCL sent to client",
      data: { ccl: result.ccl, case: result.caseRecord },
    });
  } catch (err) {
    logger.error({ err }, "reviewCclFees");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Caseworker/Admin: (re)send the CCL + a payment request while fees are outstanding. */
export const sendCclPaymentRequestAction = async (req, res) => {
  try {
    const { caseId } = req.params;
    const caseRecord = await findCaseByRef(req.tenantDb, caseId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Case not found", data: null });
    }

    const result = await sendCclPaymentRequest({
      tenantDb: req.tenantDb,
      caseRecord,
      performedBy: req.user?.userId,
      organisationId: organisationIdFromReq(req),
      requestedAmount: req.body?.requestedAmount ?? null,
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        status: "error",
        message: result.message,
        data: null,
      });
    }

    res.status(200).json({
      status: "success",
      message: "Client Care Letter and payment request sent to client",
      data: { ccl: result.ccl, emailSent: result.emailSent },
    });
  } catch (err) {
    logger.error({ err }, "sendCclPaymentRequestAction");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** @deprecated Use proposeCclFees + reviewCclFees */
export const issueCcl = async (req, res) => {
  return proposeCclFees(req, res);
};

/** Admin: list cases awaiting CCL fee approval */
export const listCclFeePendingApprovals = async (req, res) => {
  try {
    if (
      Number(req.user?.role_id) !== ROLES.ADMIN &&
      Number(req.user?.role) !== ROLES.ADMIN
    ) {
      return res.status(403).json({
        status: "error",
        message: "Admin access required",
        data: null,
      });
    }

    const { page = 1, limit = 10, search, tab = "pending" } = req.query;
    const offset = (page - 1) * limit;

    const andConditions = [];

    if (search) {
      andConditions.push({
        [Op.or]: [
          { caseId: { [Op.iLike]: `%${search}%` } },
          { "$candidate.first_name$": { [Op.iLike]: `%${search}%` } },
          { "$candidate.last_name$": { [Op.iLike]: `%${search}%` } }
        ]
      });
    }

    if (tab === "pending") {
      andConditions.push({
        [Op.or]: [
          { "$cclRecord.status$": "fee_proposed" },
          { amountStatus: "Pending Approval" }
        ]
      });
    } else if (tab === "approved") {
      andConditions.push({
        [Op.or]: [
          { "$cclRecord.status$": { [Op.in]: ["issued", "signed"] } },
          { amountStatus: "Approved" }
        ]
      });
    } else if (tab === "rejected") {
      andConditions.push({
        [Op.or]: [
          { "$cclRecord.status$": "rejected" },
          { amountStatus: "Rejected" }
        ]
      });
    } else {
      // "all" approvals: anything that has a CCL record or is in a ccl process status
      andConditions.push({
        [Op.or]: [
          { "$cclRecord.id$": { [Op.ne]: null } },
          { amountStatus: { [Op.in]: ["Pending Approval", "Approved", "Rejected"] } }
        ]
      });
    }

    const where = andConditions.length ? { [Op.and]: andConditions } : {};

    const include = [
      {
        model: req.tenantDb.User,
        as: "candidate",
        attributes: ["id", "first_name", "last_name", "email"],
      },
      {
        model: req.tenantDb.VisaType,
        as: "visaType",
        attributes: ["id", "name"],
      },
      {
        model: req.tenantDb.CaseCclRecord,
        as: "cclRecord",
        required: false,
      },
    ];

    const { count, rows: cases } = await req.tenantDb.Case.findAndCountAll({
      where,
      include,
      order: [["updated_at", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset),
      subQuery: false,
    });

    res.status(200).json({
      status: "success",
      message: "CCL fee approvals retrieved successfully",
      data: {
        cases,
        pagination: {
          total: count,
          pages: Math.ceil(count / limit),
          page: parseInt(page),
          limit: parseInt(limit),
        }
      }
    });
  } catch (err) {
    logger.error({ err }, "listCclFeePendingApprovals");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** GET CCL status for case */
export const getCclStatus = async (req, res) => {
  try {
    const caseRef = req.params.caseId || req.query.caseId;
    const caseRecord = await findCaseByRef(req.tenantDb, caseRef);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Case not found", data: null });
    }
    const ccl = await req.tenantDb.CaseCclRecord.findOne({
      where: { caseId: caseRecord.id },
    });
    res
      .status(200)
      .json({ status: "success", data: { ccl, caseId: caseRecord.caseId } });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Candidate: load Client Care Letter status and fee schedule for their case */
export const getCandidateCcl = async (req, res) => {
  try {
    const userId = req.user?.userId;
    let caseRecord = await findCaseForUser(req.tenantDb, userId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "No case found", data: null });
    }

    const { ccl: syncedCcl, caseRecord: syncedCase } =
      await syncCclReleaseForApprovedFees({
        tenantDb: req.tenantDb,
        caseRecord,
        performedBy: null,
        organisationId: organisationIdFromReq(req),
      });
    caseRecord = syncedCase || caseRecord;
    const ccl =
      syncedCcl ||
      (await req.tenantDb.CaseCclRecord.findOne({
        where: { caseId: caseRecord.id },
      }));

    if (
      isCclReleasedToClient(caseRecord, ccl) &&
      ccl &&
      !ccl.issuedDocumentId
    ) {
      await attachCclTemplateToCase({
        tenantDb: req.tenantDb,
        caseRecord,
        ccl,
        performedBy: null,
        visaTypeName: caseRecord.visaType?.name,
      }).catch((err) => logger.error({ err }, "attachCclTemplateToCase"));
      await ccl.reload();
    }

    let issuedDocument = null;
    if (ccl?.issuedDocumentId && req.tenantDb.Document) {
      const doc = await req.tenantDb.Document.findByPk(ccl.issuedDocumentId, {
        attributes: [
          "id",
          "documentName",
          "documentType",
          "documentPath",
          "status",
          "userFileName",
        ],
      });
      issuedDocument = doc ? doc.get({ plain: true }) : null;
    }

    const templateMeta = resolveCclTemplate(
      caseRecord.visaType?.name || "",
      "",
    );

    const plainCcl = ccl ? ccl.get({ plain: true }) : null;
    const caseSummary = {
      id: caseRecord.id,
      caseId: caseRecord.caseId,
      caseStage: resolveCaseStage(caseRecord),
      amountStatus: caseRecord.amountStatus,
      totalAmount: caseRecord.totalAmount,
      paidAmount: caseRecord.paidAmount,
      visaTypeName: caseRecord.visaType?.name || null,
    };

    res.status(200).json({
      status: "success",
      data: {
        ccl: plainCcl,
        case: caseSummary,
        issuedDocument,
        template: {
          label: templateMeta.label,
          fileName: templateMeta.file,
          available: templateMeta.exists,
        },
        releasedToClient: isCclReleasedToClient(caseRecord, ccl),
        stageVisible: isCclStageVisibleToCandidate(caseRecord),
        approvalSteps: buildCandidateCclApprovalTimeline(plainCcl, caseSummary),
      },
    });
  } catch (err) {
    logger.error({ err }, "getCandidateCcl");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Candidate: download Client Care Letter document (attached template or uploaded file) */
export const downloadCandidateCcl = async (req, res) => {
  try {
    const userId = req.user?.userId;
    let caseRecord = await findCaseForUser(req.tenantDb, userId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "No case found", data: null });
    }

    const { ccl: syncedCcl, caseRecord: syncedCase } =
      await syncCclReleaseForApprovedFees({
        tenantDb: req.tenantDb,
        caseRecord,
        performedBy: null,
        organisationId: organisationIdFromReq(req),
      });
    caseRecord = syncedCase || caseRecord;
    let ccl =
      syncedCcl ||
      (await req.tenantDb.CaseCclRecord.findOne({
        where: { caseId: caseRecord.id },
      }));

    if (!isCclReleasedToClient(caseRecord, ccl)) {
      return res.status(403).json({
        status: "error",
        message: "Client Care Letter is not available for your case yet",
        data: null,
      });
    }

    // Resolve the issued document, and regenerate on demand when it is missing
    // OR its file has gone from disk (e.g. cleaned up, moved, never written).
    // The candidate download is self-healing: it always rebuilds the dynamic,
    // caseworker-issued letter — never the legacy per-visa-type .docx upload.
    const loadIssuedDoc = async () =>
      ccl?.issuedDocumentId
        ? await req.tenantDb.Document.findByPk(ccl.issuedDocumentId)
        : null;
    const fileOnDisk = (doc) =>
      !!doc?.documentPath && fs.existsSync(path.resolve(doc.documentPath));

    let document = await loadIssuedDoc();

    if (!fileOnDisk(document)) {
      // Force a fresh generation from the draft/template.
      if (ccl?.issuedDocumentId) await ccl.update({ issuedDocumentId: null });
      await attachCclTemplateToCase({
        tenantDb: req.tenantDb,
        caseRecord,
        ccl,
        performedBy: null,
        visaTypeName: caseRecord.visaType?.name,
      });
      await ccl.reload();
      document = await loadIssuedDoc();
    }

    if (!fileOnDisk(document)) {
      return res.status(404).json({
        status: "error",
        message: "Your Client Care Letter is being prepared. Please try again shortly.",
        data: null,
      });
    }

    return res.download(
      path.resolve(document.documentPath),
      document.userFileName || document.documentName || "client-care-letter.pdf",
    );
  } catch (err) {
    logger.error({ err }, "downloadCandidateCcl");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Candidate: accept Client Care Letter (checkbox confirmation) */
export const acceptCcl = async (req, res) => {
  try {
    const userId = req.user?.userId;
    let caseRecord = await findCaseForUser(req.tenantDb, userId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "No case found", data: null });
    }

    const { ccl: syncedCcl, caseRecord: syncedCase } =
      await syncCclReleaseForApprovedFees({
        tenantDb: req.tenantDb,
        caseRecord,
        performedBy: userId,
        organisationId: organisationIdFromReq(req),
      });
    caseRecord = syncedCase || caseRecord;
    let ccl =
      syncedCcl ||
      (await req.tenantDb.CaseCclRecord.findOne({
        where: { caseId: caseRecord.id },
      }));

    if (!isCclReleasedToClient(caseRecord, ccl)) {
      return res.status(400).json({
        status: "error",
        message: "Client Care Letter has not been issued yet",
        data: null,
      });
    }

    if (ccl && ccl.status !== "issued" && ccl.status !== "signed") {
      await ccl.update({
        status: "issued",
        issuedAt: ccl.issuedAt || new Date(),
      });
      await ccl.reload();
    }

    if (!ccl || (ccl.status !== "issued" && ccl.status !== "signed")) {
      return res.status(400).json({
        status: "error",
        message: "Client Care Letter has not been issued yet",
        data: null,
      });
    }

    if (ccl.status === "signed") {
      return res.status(200).json({
        status: "success",
        message: "Client Care Letter already accepted",
        data: { ccl, paid: ["paid", "Paid"].includes(caseRecord.amountStatus) },
      });
    }

    await ccl.update({
      status: "signed",
      signedAt: new Date(),
    });

    await recordTimelineEntry({
      tenantDb: req.tenantDb,
      caseId: caseRecord.id,
      actionType: "case_updated",
      description: "Client Care Letter accepted by candidate",
      performedBy: userId,
      visibility: "public",
    });

    // Assign UK Visa Portal task (only ONE task per case, not per caseworker!)
    const raw =
      caseRecord?.assignedcaseworkerId ?? caseRecord?.assignedCaseworkerId;
    let cwIds = [];
    if (raw) {
      if (Array.isArray(raw)) {
        cwIds = raw.map(Number).filter((n) => Number.isFinite(n) && n > 0);
      } else if (typeof raw === "object" && raw !== null) {
        const ids = raw.ids ?? raw.caseworkers ?? Object.values(raw);
        if (Array.isArray(ids))
          cwIds = ids.map(Number).filter((n) => Number.isFinite(n) && n > 0);
      } else {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) cwIds = [n];
      }
    }
    cwIds = [...new Set(cwIds)];

    const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
    const taskTitle = `Submit Application on UK Visa Portal — ${caseLabel}`;

    // First, check if ANY such task exists for this case (any status, any assignee)
    const anyExistingTask = await req.tenantDb.Task.findOne({
      where: {
        case_id: caseRecord.id,
        title: { [req.tenantDb.Sequelize.Op.iLike]: `%${taskTitle}%` },
      },
    });
    if (!anyExistingTask && cwIds.length > 0) {
      const assigneeId = cwIds[0]; // assign to first caseworker
      try {
        await req.tenantDb.Task.create({
          title: taskTitle,
          assigned_to: assigneeId,
          case_id: caseRecord.id,
          priority: "high",
          status: "pending",
          due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0],
          created_by: userId || assigneeId,
        });
      } catch (taskErr) {
        logger.error({ err: taskErr }, "Failed to assign UK visa portal task");
      }
    }

    const paid =
      ["paid", "Paid"].includes(caseRecord.amountStatus) ||
      (Number(caseRecord.totalAmount) > 0 &&
        Number(caseRecord.paidAmount) >= Number(caseRecord.totalAmount));

    if (paid) {
      await applyCaseStageChange({
        tenantDb: req.tenantDb,
        caseRecord,
        nextStageId: "ccl_payment_received",
        performedBy: userId,
        organisationId: organisationIdFromReq(req),
        reason: "CCL accepted and payment received",
        sendEmail: false,
      });
    }

    res.status(200).json({
      status: "success",
      message: "Client Care Letter accepted",
      data: { ccl, paid },
    });
  } catch (err) {
    logger.error({ err }, "acceptCcl");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Candidate: mark CCL signed (links uploaded signed document) */
export const confirmCclSigned = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { documentId } = req.body;
    const caseRecord = await findCaseForUser(req.tenantDb, userId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "No case found", data: null });
    }

    const ccl = await req.tenantDb.CaseCclRecord.findOne({
      where: { caseId: caseRecord.id },
    });
    if (!ccl || ccl.status !== "issued") {
      return res.status(400).json({
        status: "error",
        message: "Client Care Letter has not been issued yet",
        data: null,
      });
    }

    await ccl.update({
      status: "signed",
      signedDocumentId: documentId || ccl.signedDocumentId,
      signedAt: new Date(),
    });

    await recordTimelineEntry({
      tenantDb: req.tenantDb,
      caseId: caseRecord.id,
      actionType: "document_uploaded",
      description: "Signed Client Care Letter received",
      performedBy: userId,
      visibility: "public",
    });

    // Assign UK Visa Portal task (only ONE task per case, not per caseworker!)
    const raw =
      caseRecord?.assignedcaseworkerId ?? caseRecord?.assignedCaseworkerId;
    let cwIds = [];
    if (raw) {
      if (Array.isArray(raw)) {
        cwIds = raw.map(Number).filter((n) => Number.isFinite(n) && n > 0);
      } else if (typeof raw === "object" && raw !== null) {
        const ids = raw.ids ?? raw.caseworkers ?? Object.values(raw);
        if (Array.isArray(ids))
          cwIds = ids.map(Number).filter((n) => Number.isFinite(n) && n > 0);
      } else {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) cwIds = [n];
      }
    }
    cwIds = [...new Set(cwIds)];

    const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
    const taskTitle = `Submit Application on UK Visa Portal — ${caseLabel}`;

    // First, check if ANY such task exists for this case (any status, any assignee)
    const anyExistingTask = await req.tenantDb.Task.findOne({
      where: {
        case_id: caseRecord.id,
        title: { [req.tenantDb.Sequelize.Op.iLike]: `%${taskTitle}%` },
      },
    });
    if (!anyExistingTask && cwIds.length > 0) {
      const assigneeId = cwIds[0]; // assign to first caseworker
      try {
        await req.tenantDb.Task.create({
          title: taskTitle,
          assigned_to: assigneeId,
          case_id: caseRecord.id,
          priority: "high",
          status: "pending",
          due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0],
          created_by: userId || assigneeId,
        });
      } catch (taskErr) {
        logger.error({ err: taskErr }, "Failed to assign UK visa portal task");
      }
    }

    const paid = Number(caseRecord.paidAmount) || 0;
    const total = Number(caseRecord.totalAmount) || 0;
    if (total > 0 && paid >= total) {
      await applyCaseStageChange({
        tenantDb: req.tenantDb,
        caseRecord,
        nextStageId: "ccl_payment_received",
        performedBy: userId,
        organisationId: organisationIdFromReq(req),
        reason: "Signed CCL and payment received",
        sendEmail: false,
      });
    }

    res.status(200).json({ status: "success", data: { ccl } });
  } catch (err) {
    logger.error({ err }, "confirmCclSigned");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Candidate: list decision documents for download */
export const getDecisionDocuments = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const caseRecord = await findCaseForUser(req.tenantDb, userId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "No case found", data: null });
    }

    const stage = resolveCaseStage(caseRecord);
    const unlocked = ["decision_communicated", "case_closure"].includes(stage);

    // Staff-uploaded final/decision documents are authoritative — they do NOT
    // need a separate approval step, so accept "uploaded" as well as "approved".
    const docs = await req.tenantDb.Document.findAll({
      where: {
        caseId: caseRecord.id,
        documentType: { [Op.in]: DECISION_DOC_TYPES },
        status: { [Op.in]: ["uploaded", "approved"] },
      },
      order: [["created_at", "DESC"]],
      attributes: [
        "id",
        "documentType",
        "documentName",
        "userFileName",
        "status",
        "created_at",
      ],
    });

    res.status(200).json({
      status: "success",
      data: {
        unlocked,
        caseStage: stage,
        documents: docs,
        placeholders: [
          {
            type: "Decision Letter",
            available:
              unlocked &&
              docs.some((d) => d.documentType === "Decision Letter"),
          },
          {
            type: "Approval Notice",
            available:
              unlocked &&
              docs.some((d) => d.documentType === "Approval Notice"),
          },
          {
            type: "Visa Copy",
            available:
              unlocked && docs.some((d) => d.documentType === "Visa Copy"),
          },
          {
            type: "BRP Information",
            available:
              unlocked &&
              docs.some((d) => d.documentType === "BRP Information"),
          },
        ],
      },
    });
  } catch (err) {
    logger.error({ err }, "getDecisionDocuments");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Candidate: payment schedule (visible only after admin approves CCL fees) */
export const getCandidatePaymentSchedule = async (req, res) => {
  try {
    const userId = req.user?.userId;
    let caseRecord = await findCaseForUser(req.tenantDb, userId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "No case found", data: null });
    }

    const { ccl: syncedCcl, caseRecord: syncedCase } =
      await syncCclReleaseForApprovedFees({
        tenantDb: req.tenantDb,
        caseRecord,
        performedBy: null,
        organisationId: organisationIdFromReq(req),
      });
    caseRecord = syncedCase || caseRecord;
    const ccl =
      syncedCcl ||
      (await req.tenantDb.CaseCclRecord.findOne({
        where: { caseId: caseRecord.id },
      }));

    const approved = isCclReleasedToClient(caseRecord, ccl);
    const totalFee = resolveCaseFeeTotal(caseRecord, ccl);
    const paidAmount = Number(caseRecord.paidAmount) || 0;

    if (!approved || totalFee <= 0) {
      return res.status(200).json({
        status: "success",
        data: {
          visible: false,
          message:
            totalFee <= 0 && approved
              ? "Your fees are approved but no payment amount is set yet. Your caseworker will confirm the total shortly."
              : "Payment schedule will appear after your caseworker and admin approve your Client Care Letter fees.",
          caseId: caseRecord.caseId,
          cclStatus: ccl?.status || "pending",
          amountStatus: caseRecord.amountStatus,
        },
      });
    }

    const installments =
      ccl &&
      Array.isArray(ccl.installmentPlan) &&
      ccl.installmentPlan.length > 0
        ? ccl.installmentPlan
        : [{ label: "Full fee", amount: totalFee, dueDate: null }];

    const balanceDue = Math.max(0, totalFee - paidAmount);

    // Surface an explicit staff payment request (if one was sent and is still due)
    // so the candidate's Payments page can highlight the amount to pay now.
    const paymentRequest =
      ccl?.paymentRequestSentAt && balanceDue > 0
        ? {
            requestedAmount:
              Number(ccl.paymentRequestAmount) > 0
                ? Number(ccl.paymentRequestAmount)
                : balanceDue,
            sentAt: ccl.paymentRequestSentAt,
            count: Number(ccl.paymentRequestCount) || 1,
          }
        : null;

    res.status(200).json({
      status: "success",
      data: {
        visible: true,
        caseId: caseRecord.caseId,
        caseStage: resolveCaseStage(caseRecord),
        totalFee,
        paidAmount,
        balanceDue,
        amountStatus: caseRecord.amountStatus,
        installments,
        paymentRequest,
        ccl: ccl
          ? {
              status: ccl.status,
              issuedAt: ccl.issuedAt,
              signedAt: ccl.signedAt,
            }
          : null,
      },
    });
  } catch (err) {
    logger.error({ err }, "getCandidatePaymentSchedule");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Candidate: tasks assigned to them (e.g. Data Capture Sheet) */
export const getCandidateTasks = async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ status: "error", message: "Unauthorized", data: null });
    }

    const rows = await req.tenantDb.Task.findAll({
      where: { assigned_to: userId },
      order: [
        ["status", "ASC"],
        ["due_date", "ASC"],
        ["id", "DESC"],
      ],
      include: [
        {
          model: req.tenantDb.Case,
          as: "case",
          attributes: ["id", "caseId"],
          required: false,
        },
      ],
    });

    const caseIds = [...new Set(rows.map((r) => r.case_id).filter(Boolean))];
    const caseRows =
      caseIds.length > 0
        ? await req.tenantDb.Case.findAll({
            where: { id: caseIds },
            attributes: [
              "id",
              "caseId",
              "caseStage",
              "proposedAmount",
              "totalAmount",
              "paidAmount",
              "amountStatus",
              "biometricLocation",
              "biometricTime",
              "biometricDay",
              "biometricsDate",
            ],
          })
        : [];
    const caseById = Object.fromEntries(
      caseRows.map((c) => [c.id, c.get({ plain: true })]),
    );

    const tasks = rows.map((row) => {
      const plain = row.get({ plain: true });
      const caseRef =
        plain.case?.caseId || (plain.case_id ? `#${plain.case_id}` : null);
      const caseRow = plain.case_id ? caseById[plain.case_id] : null;
      const title = plain.title || "";
      const isBiometricAttend = /attend biometrics/i.test(title);
      const isCasePayment = /pay case fee/i.test(title);
      const isCclPayment =
        isCasePayment ||
        /pay ccl fee/i.test(title) ||
        (/client care|ccl/i.test(title) && /pay|fee/i.test(title));
      const feeFromCase =
        caseRow?.proposedAmount ?? caseRow?.totalAmount ?? null;
      return {
        id: plain.id,
        title: plain.title,
        status: plain.status,
        priority: plain.priority,
        due_date: plain.due_date,
        case_id: plain.case_id,
        caseRef,
        isCclPayment,
        isCasePayment,
        cclFeeAmount: feeFromCase != null ? Number(feeFromCase) : null,
        isDataCapture:
          /data capture sheet/i.test(plain.title || "") ||
          plain.title?.toLowerCase().includes("data capture"),
        isBiometricAttend,
        biometricDetails:
          isBiometricAttend && caseRow
            ? {
                location: caseRow.biometricLocation,
                date: caseRow.biometricsDate,
                time: caseRow.biometricTime,
                day: caseRow.biometricDay,
                caseStage: resolveCaseStage(caseRow),
              }
            : null,
      };
    });

    res.status(200).json({
      status: "success",
      data: { tasks },
    });
  } catch (err) {
    logger.error({ err }, "getCandidateTasks");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Candidate: mark own task complete */
export const completeCandidateTask = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const taskId = parseInt(req.params.taskId, 10);
    if (!userId || Number.isNaN(taskId)) {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid request", data: null });
    }

    const task = await req.tenantDb.Task.findByPk(taskId);
    if (!task || task.assigned_to !== userId) {
      return res
        .status(404)
        .json({ status: "error", message: "Task not found", data: null });
    }

    const isBiometricAttend = /attend biometrics/i.test(task.title || "");

    if (isBiometricAttend && task.case_id) {
      const caseRecord = await req.tenantDb.Case.findByPk(task.case_id);
      if (!caseRecord) {
        return res
          .status(404)
          .json({ status: "error", message: "Case not found", data: null });
      }

      const result = await markBiometricAttendedByCandidate({
        tenantDb: req.tenantDb,
        caseRecord,
        performedBy: userId,
        organisationId: organisationIdFromReq(req),
      });

      if (!result.ok) {
        return res.status(result.status || 400).json({
          status: "error",
          message: result.message,
          data: null,
        });
      }

      await task.update({ status: "completed" });
      await caseRecord.reload();

      return res.status(200).json({
        status: "success",
        message: "Biometrics attendance recorded",
        data: {
          task: task.get({ plain: true }),
          caseStage: resolveCaseStage(caseRecord),
        },
      });
    }

    await task.update({ status: "completed" });

    let caseStage = null;
    if (task.case_id && /data capture/i.test(task.title || "")) {
      try {
        const caseRecord = await req.tenantDb.Case.findByPk(task.case_id);
        if (caseRecord) {
          await applyCaseStageChange({
            tenantDb: req.tenantDb,
            caseRecord,
            nextStageId: "application_preparation",
            performedBy: userId,
            organisationId: organisationIdFromReq(req),
            reason: "Candidate marked Data Capture Sheet task as complete",
          });
          await caseRecord.reload();
          caseStage = resolveCaseStage(caseRecord);
        }
      } catch (stageErr) {
        logger.error(
          { err: stageErr },
          "completeCandidateTask Data Capture stage advance error",
        );
      }
    }

    res.status(200).json({
      status: "success",
      message: "Task marked complete",
      data: {
        task: task.get({ plain: true }),
        ...(caseStage ? { caseStage } : {}),
      },
    });
  } catch (err) {
    logger.error({ err }, "completeCandidateTask");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Caseworker: get workflow bundle for case detail */
export const getCaseWorkflowBundle = async (req, res) => {
  try {
    const caseRecord = await findCaseByRef(req.tenantDb, req.params.caseId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Case not found", data: null });
    }

    const [submission, ccl, template] = await Promise.all([
      req.tenantDb.DataCaptureSubmission.findOne({
        where: { caseId: caseRecord.id },
      }),
      req.tenantDb.CaseCclRecord.findOne({ where: { caseId: caseRecord.id } }),
      resolveTemplate(req.tenantDb, caseRecord.visaTypeId),
    ]);

    res.status(200).json({
      status: "success",
      data: {
        caseStage: resolveCaseStage(caseRecord),
        workflowState: getWorkflowState(caseRecord),
        biometricLocation: caseRecord.biometricLocation,
        biometricTime: caseRecord.biometricTime,
        biometricDay: caseRecord.biometricDay,
        biometricsDate: caseRecord.biometricsDate,
        proposedAmount: caseRecord.proposedAmount,
        totalAmount: caseRecord.totalAmount,
        paidAmount: caseRecord.paidAmount,
        amountStatus: caseRecord.amountStatus,
        dataCapture: { template, submission },
        ccl,
      },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Candidate: workflow process status (draft review, biometrics, etc.) */
export const getCandidateWorkflowProcess = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const caseRecord = await findCaseForUser(req.tenantDb, userId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "No case found", data: null });
    }

    const app = await req.tenantDb.CandidateApplication.findOne({
      where: { userId },
    });
    const timezone = await resolveUserTimezone(req.tenantDb, userId);
    const workflowState = getWorkflowState(caseRecord);
    const caseStage = resolveCaseStage(caseRecord);
    const hasBiometricAppointment = hasBiometricAppointmentBooked(
      caseRecord,
      workflowState,
    );
    const biometricAttended = Boolean(workflowState.biometrics?.attendedAt);
    const canMarkBiometricAttended =
      hasBiometricAppointment &&
      !biometricAttended &&
      getStageOrder(caseStage) < getStageOrder("awaiting_decision");

    res.status(200).json({
      status: "success",
      data: {
        caseId: caseRecord.caseId,
        caseStage,
        proposedAmount: caseRecord.proposedAmount,
        biometricLocation: caseRecord.biometricLocation || workflowState.biometrics?.bookedSlot?.location || null,
        biometricTime: caseRecord.biometricTime || workflowState.biometrics?.bookedSlot?.appointmentTime || null,
        biometricDay: caseRecord.biometricDay || workflowState.biometrics?.bookedSlot?.appointmentDay || null,
        biometricsDate: caseRecord.biometricsDate || workflowState.biometrics?.bookedSlot?.appointmentDate || null,
        hasBiometricAppointment,
        canMarkBiometricAttended,
        timezone,
        workflowState,
        application: app
          ? {
              status: app.status,
              isLocked: app.isLocked,
              submittedAt: app.submittedAt,
            }
          : null,
      },
    });
  } catch (err) {
    logger.error({ err }, "getCandidateWorkflowProcess");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Candidate: confirm or reject draft application (Yes / No) */
export const submitCandidateDraftReview = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { confirmed } = req.body;
    if (typeof confirmed !== "boolean") {
      return res.status(400).json({
        status: "error",
        message: "confirmed must be true (Yes) or false (No)",
        data: null,
      });
    }

    const caseRecord = await findCaseForUser(req.tenantDb, userId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "No case found", data: null });
    }

    const result = await submitDraftReviewDecision({
      tenantDb: req.tenantDb,
      caseRecord,
      confirmed,
      performedBy: userId,
      organisationId: organisationIdFromReq(req),
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        status: "error",
        message: result.message,
        data: null,
      });
    }

    await caseRecord.reload();

    res.status(200).json({
      status: "success",
      data: {
        confirmed,
        unlocked: result.unlocked || false,
        caseStage: resolveCaseStage(caseRecord),
        workflowState: getWorkflowState(caseRecord),
      },
    });
  } catch (err) {
    logger.error({ err }, "submitCandidateDraftReview");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Candidate: submit biometric appointment availability */
export const submitCandidateBiometricAvailability = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { preferredLocation, preferredDate, preferredTime, notes, timezone } =
      req.body;
    // Prefer the timezone the candidate explicitly chose on the form; fall back
    // to their stored user/org timezone when the form didn't send one.
    const submittedTz = String(timezone || "").trim();
    const candidateTimezone =
      submittedTz || (await resolveUserTimezone(req.tenantDb, userId));

    const caseRecord = await findCaseForUser(req.tenantDb, userId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "No case found", data: null });
    }

    const result = await submitBiometricAvailability({
      tenantDb: req.tenantDb,
      caseRecord,
      preferredLocation,
      preferredDate,
      preferredTime,
      notes,
      candidateTimezone,
      performedBy: userId,
      organisationId: organisationIdFromReq(req),
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        status: "error",
        message: result.message,
        data: null,
      });
    }

    await caseRecord.reload();

    res.status(200).json({
      status: "success",
      data: {
        caseStage: resolveCaseStage(caseRecord),
        workflowState: getWorkflowState(caseRecord),
      },
    });
  } catch (err) {
    logger.error({ err }, "submitCandidateBiometricAvailability");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Candidate: confirm biometrics attendance → awaiting decision */
export const candidateMarkBiometricAttended = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const caseRecord = await findCaseForUser(req.tenantDb, userId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "No case found", data: null });
    }

    const result = await markBiometricAttendedByCandidate({
      tenantDb: req.tenantDb,
      caseRecord,
      performedBy: userId,
      organisationId: organisationIdFromReq(req),
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        status: "error",
        message: result.message,
        data: null,
      });
    }

    await caseRecord.reload();

    const app = await req.tenantDb.CandidateApplication.findOne({
      where: { userId },
    });

    res.status(200).json({
      status: "success",
      message: "Biometrics attendance recorded",
      data: {
        caseStage: resolveCaseStage(caseRecord),
        caseStatus: caseRecord.status,
        workflowState: getWorkflowState(caseRecord),
        proposedAmount: caseRecord.proposedAmount,
        biometricLocation: caseRecord.biometricLocation,
        biometricTime: caseRecord.biometricTime,
        biometricDay: caseRecord.biometricDay,
        biometricsDate: caseRecord.biometricsDate,
        hasBiometricAppointment: hasBiometricAppointmentBooked(
          caseRecord,
          getWorkflowState(caseRecord),
        ),
        canMarkBiometricAttended: false,
        application: app
          ? {
              status: app.status,
              isLocked: app.isLocked,
              submittedAt: app.submittedAt,
            }
          : null,
      },
    });
  } catch (err) {
    logger.error({ err }, "candidateMarkBiometricAttended");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Staff: mark application submitted on visa portal */
export const staffRecordVisaPortalSubmission = async (req, res) => {
  try {
    const caseRecord = await findCaseByRef(req.tenantDb, req.params.caseId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Case not found", data: null });
    }

    const result = await recordVisaPortalSubmission({
      tenantDb: req.tenantDb,
      caseRecord,
      reference: req.body?.reference || req.body?.submissionReference,
      performedBy: req.user?.userId,
      organisationId: organisationIdFromReq(req),
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        status: "error",
        message: result.message,
        data: null,
      });
    }

    await caseRecord.reload();

    res.status(200).json({
      status: "success",
      data: {
        caseStage: resolveCaseStage(caseRecord),
        workflowState: getWorkflowState(caseRecord),
      },
    });
  } catch (err) {
    logger.error({ err }, "staffRecordVisaPortalSubmission");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Staff: send booked biometric slot to candidate */
export const staffSendBiometricSlot = async (req, res) => {
  try {
    const caseRecord = await findCaseByRef(req.tenantDb, req.params.caseId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Case not found", data: null });
    }

    const {
      location,
      appointmentDate,
      appointmentTime,
      appointmentDay,
      biometricDay,
      biometricLocation,
      biometricDate,
      biometricTime,
      instructions,
      biometricInstructions,
    } = req.body;

    const slotLocation = biometricLocation || location;
    const slotDate = biometricDate || appointmentDate;
    const slotTime = biometricTime || appointmentTime;
    const slotDay = biometricDay || appointmentDay;
    const slotInstructions = biometricInstructions || instructions;

    const result = await bookBiometricDirect({
      tenantDb: req.tenantDb,
      caseRecord,
      location: slotLocation,
      appointmentDate: slotDate,
      appointmentDay: slotDay,
      appointmentTime: slotTime,
      instructions: slotInstructions,
      performedBy: req.user?.userId,
      organisationId: organisationIdFromReq(req),
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        status: "error",
        message: result.message,
        data: null,
      });
    }

    await caseRecord.reload();

    res.status(200).json({
      status: "success",
      data: {
        caseStage: resolveCaseStage(caseRecord),
        workflowState: getWorkflowState(caseRecord),
      },
    });
  } catch (err) {
    logger.error({ err }, "staffSendBiometricSlot");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Staff: confirm biometric documents uploaded */
export const staffRecordBiometricDocsUploaded = async (req, res) => {
  try {
    const caseRecord = await findCaseByRef(req.tenantDb, req.params.caseId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Case not found", data: null });
    }

    const result = await recordBiometricDocumentsUploaded({
      tenantDb: req.tenantDb,
      caseRecord,
      performedBy: req.user?.userId,
      organisationId: organisationIdFromReq(req),
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        status: "error",
        message: result.message,
        data: null,
      });
    }

    await caseRecord.reload();

    res.status(200).json({
      status: "success",
      data: {
        caseStage: resolveCaseStage(caseRecord),
        workflowState: getWorkflowState(caseRecord),
      },
    });
  } catch (err) {
    logger.error({ err }, "staffRecordBiometricDocsUploaded");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Staff: record visa portal email reply */
export const staffRecordVisaPortalReply = async (req, res) => {
  try {
    const caseRecord = await findCaseByRef(req.tenantDb, req.params.caseId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Case not found", data: null });
    }

    const result = await recordVisaPortalReply({
      tenantDb: req.tenantDb,
      caseRecord,
      replySummary: req.body?.replySummary || req.body?.summary,
      performedBy: req.user?.userId,
      organisationId: organisationIdFromReq(req),
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        status: "error",
        message: result.message,
        data: null,
      });
    }

    await caseRecord.reload();

    res.status(200).json({
      status: "success",
      data: {
        caseStage: resolveCaseStage(caseRecord),
        workflowState: getWorkflowState(caseRecord),
      },
    });
  } catch (err) {
    logger.error({ err }, "staffRecordVisaPortalReply");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Staff: communicate Home Office decision to candidate */
export const staffCommunicateDecision = async (req, res) => {
  try {
    const caseRecord = await findCaseByRef(req.tenantDb, req.params.caseId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Case not found", data: null });
    }

    const result = await communicateDecision({
      tenantDb: req.tenantDb,
      caseRecord,
      outcome: req.body?.outcome,
      notes: req.body?.notes,
      performedBy: req.user?.userId,
      organisationId: organisationIdFromReq(req),
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        status: "error",
        message: result.message,
        data: null,
      });
    }

    await caseRecord.reload();

    res.status(200).json({
      status: "success",
      data: {
        caseStage: resolveCaseStage(caseRecord),
        workflowState: getWorkflowState(caseRecord),
      },
    });
  } catch (err) {
    logger.error({ err }, "staffCommunicateDecision");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Staff: mark an approved case as completed and closed. */
export const staffMarkCaseCompleted = async (req, res) => {
  try {
    const caseRecord = await findCaseByRef(req.tenantDb, req.params.caseId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Case not found", data: null });
    }

    const result = await markCaseCompleted({
      tenantDb: req.tenantDb,
      caseRecord,
      performedBy: req.user?.userId,
      organisationId: organisationIdFromReq(req),
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        status: "error",
        message: result.message,
        data: null,
      });
    }

    await caseRecord.reload();
    res.status(200).json({
      status: "success",
      message: result.alreadyClosed
        ? "Case is already closed"
        : "Case marked as completed and closed",
      data: {
        caseStage: resolveCaseStage(caseRecord),
        status: caseRecord.status,
      },
    });
  } catch (err) {
    logger.error({ err }, "staffMarkCaseCompleted");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Candidate: request their final documents from the case team. */
export const candidateRequestFinalDocuments = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const caseRecord = await findCaseForUser(req.tenantDb, userId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "No case found", data: null });
    }

    const result = await requestFinalDocuments({
      tenantDb: req.tenantDb,
      caseRecord,
      requestedBy: userId,
      organisationId: organisationIdFromReq(req),
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        status: "error",
        message: result.message,
        data: null,
      });
    }

    res.status(200).json({
      status: "success",
      message: "Your request has been sent to your case team",
      data: { notified: result.notified },
    });
  } catch (err) {
    logger.error({ err }, "candidateRequestFinalDocuments");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Staff: re-send all final documents to the candidate by email. */
export const staffResendFinalDocuments = async (req, res) => {
  try {
    const caseRecord = await findCaseByRef(req.tenantDb, req.params.caseId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Case not found", data: null });
    }

    const result = await resendFinalDocuments({
      tenantDb: req.tenantDb,
      caseRecord,
      performedBy: req.user?.userId,
      organisationId: organisationIdFromReq(req),
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        status: "error",
        message: result.message,
        data: null,
      });
    }

    res.status(200).json({
      status: "success",
      message: `Final documents re-sent to the candidate (${result.sent}/${result.total})`,
      data: { sent: result.sent, total: result.total },
    });
  } catch (err) {
    logger.error({ err }, "staffResendFinalDocuments");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Staff: generate a case closure letter (branded PDF) for the candidate. */
export const staffGenerateClosureLetter = async (req, res) => {
  try {
    const caseRecord = await findCaseByRef(req.tenantDb, req.params.caseId);
    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Case not found", data: null });
    }

    const result = await generateCaseClosureLetter({
      tenantDb: req.tenantDb,
      caseRecord,
      performedBy: req.user?.userId,
      organisationId: organisationIdFromReq(req),
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        status: "error",
        message: result.message,
        data: null,
      });
    }

    res.status(200).json({
      status: "success",
      message: "Case closure letter generated and shared with the candidate",
      data: { document: result.document },
    });
  } catch (err) {
    logger.error({ err }, "staffGenerateClosureLetter");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/**
 * Staff: upload a decision document (Decision Letter / Approval Notice /
 * Visa Copy / BRP Information) for a case and notify the candidate by email.
 *
 * Expects multipart/form-data with:
 *   - files[]  : the file (from handleDocumentUpload middleware)
 *   - documentType : one of DECISION_DOC_TYPES
 */
export const staffUploadDecisionDocument = async (req, res) => {
  try {
    const documentType = req.body?.documentType?.trim();
    if (!documentType || !DECISION_DOC_TYPES.includes(documentType)) {
      return res.status(400).json({
        status: "error",
        message: `documentType must be one of: ${DECISION_DOC_TYPES.join(", ")}`,
        data: null,
      });
    }

    const file = req.files?.[0];
    if (!file) {
      return res.status(400).json({ status: "error", message: "No file uploaded", data: null });
    }

    const caseRecord = await findCaseByRef(req.tenantDb, req.params.caseId);
    if (!caseRecord) {
      if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(404).json({ status: "error", message: "Case not found", data: null });
    }

    const uploadedBy = req.user?.userId ?? req.user?.id;
    const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;

    // Move file to permanent case storage
    const targetDir = path.join("storage", "private", "caseimages", String(caseRecord.id));
    fs.mkdirSync(targetDir, { recursive: true });
    const ext = path.extname(file.originalname || ".pdf");
    const systemName = `${documentType.replace(/[\s/]+/g, "_").toUpperCase()}-${Date.now()}${ext}`;
    const targetPath = path.join(targetDir, systemName);
    fs.renameSync(file.path, targetPath);

    // Upsert: replace existing record for this type if one exists
    const existing = await req.tenantDb.Document.findOne({
      where: { caseId: caseRecord.id, documentType },
      order: [["uploadedAt", "DESC"]],
    });

    let document;
    const docMeta = {
      documentName: systemName,
      userFileName: file.originalname || systemName,
      documentPath: targetPath,
      documentCategory: "decision",
      mimeType: file.mimetype,
      fileSize: file.size,
      uploadedBy,
      uploadedAt: new Date(),
      status: "uploaded",
    };

    if (existing) {
      if (existing.documentPath && fs.existsSync(existing.documentPath)) {
        try { fs.unlinkSync(existing.documentPath); } catch { /* ignore stale cleanup */ }
      }
      await existing.update(docMeta);
      document = await existing.reload();
    } else {
      document = await req.tenantDb.Document.create({
        userId: caseRecord.candidateId ?? uploadedBy,
        caseId: caseRecord.id,
        documentType,
        ...docMeta,
      });
    }

    // Email the document as an attachment + in-app notification.
    if (caseRecord.candidateId) {
      try {
        await emailCaseDocumentToCandidate({
          tenantDb: req.tenantDb,
          caseRecord,
          document,
          filePath: targetPath,
          organisationId: organisationIdFromReq(req),
        });
        await notifyUser(req.tenantDb, caseRecord.candidateId, {
          type: NotificationTypes.SUCCESS,
          priority: NotificationPriority.HIGH,
          category: "document",
          title: `${documentType} is now available`,
          message: `Your ${documentType.toLowerCase()} for case ${caseLabel} has been emailed to you and is available to download from your Final Documents.`,
          entityType: "document",
          entityId: document.id,
          actionType: "decision_document_uploaded",
          actionUrl: "/my-account?tab=downloads",
          sendEmail: false,
          organisationId: organisationIdFromReq(req),
        });
      } catch (notifErr) {
        logger.error({ err: notifErr }, "staffUploadDecisionDocument: notification failed");
      }
    }

    res.status(200).json({
      status: "success",
      data: {
        document: {
          id: document.id,
          documentType: document.documentType,
          documentName: document.documentName,
          userFileName: document.userFileName,
          uploadedAt: document.uploadedAt,
          status: document.status,
        },
      },
    });
  } catch (err) {
    logger.error({ err }, "staffUploadDecisionDocument");
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};
