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
} from "../../../services/caseWorkflowProcess.service.js";
import {
  submitCclFeeProposal,
  reviewCclFeeProposal,
} from "../../../services/cclFeeProposal.service.js";
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

    const sheetAttachment = await buildDataCaptureSheetPdfAttachment({
      template,
      caseRecord,
      candidate,
      visaTypeName: visaType?.name || "",
      requiredDocuments,
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

    const cases = await req.tenantDb.Case.findAll({
      include: [
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
          required: true,
          where: { status: "fee_proposed" },
        },
      ],
      order: [["updated_at", "DESC"]],
    });

    res.status(200).json({ status: "success", data: { cases } });
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

    if (ccl && !ccl.issuedDocumentId) {
      await attachCclTemplateToCase({
        tenantDb: req.tenantDb,
        caseRecord,
        ccl,
        performedBy: null,
        visaTypeName: caseRecord.visaType?.name,
      });
      await ccl.reload();
    }

    if (!ccl?.issuedDocumentId) {
      const template = resolveCclTemplate(caseRecord.visaType?.name || "");
      if (!template.exists) {
        return res.status(404).json({
          status: "error",
          message: "Client Care Letter file not found",
          data: null,
        });
      }
      return res.download(template.absolutePath, template.file);
    }

    const document = await req.tenantDb.Document.findByPk(ccl.issuedDocumentId);
    if (!document?.documentPath) {
      return res.status(404).json({
        status: "error",
        message: "Client Care Letter file not found",
        data: null,
      });
    }

    const absolutePath = path.resolve(document.documentPath);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({
        status: "error",
        message: "Client Care Letter file not found on server",
        data: null,
      });
    }

    return res.download(
      absolutePath,
      document.userFileName ||
        document.documentName ||
        "client-care-letter.docx",
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

    const docs = await req.tenantDb.Document.findAll({
      where: {
        caseId: caseRecord.id,
        documentType: { [Op.in]: DECISION_DOC_TYPES },
        status: "approved",
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

    res.status(200).json({
      status: "success",
      data: {
        visible: true,
        caseId: caseRecord.caseId,
        caseStage: resolveCaseStage(caseRecord),
        totalFee,
        paidAmount,
        balanceDue: Math.max(0, totalFee - paidAmount),
        amountStatus: caseRecord.amountStatus,
        installments,
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
      const isCclPayment =
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
        biometricLocation: caseRecord.biometricLocation,
        biometricTime: caseRecord.biometricTime,
        biometricDay: caseRecord.biometricDay,
        biometricsDate: caseRecord.biometricsDate,
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
    const { preferredLocation, preferredDate, preferredTime, notes } = req.body;
    const candidateTimezone = await resolveUserTimezone(req.tenantDb, userId);

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
