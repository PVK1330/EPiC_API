import { Op } from "sequelize";
import { resolveCaseStage, STAGE_TO_LEGACY_STATUS } from "../../../constants/immigrationCaseProcess.js";
import { applyCaseStageChange } from "../../../services/caseStageAutomation.service.js";
import { sendWorkflowStageEmail } from "../../../services/workflowEmail.service.js";
import { recordTimelineEntry } from "../../../services/caseTimeline.service.js";

const DECISION_DOC_TYPES = ["Decision Letter", "Approval Notice", "Visa Copy", "BRP Information"];

async function findCaseForUser(tenantDb, userId) {
  return tenantDb.Case.findOne({
    where: { candidateId: userId },
    order: [["created_at", "DESC"]],
    include: [{ model: tenantDb.VisaType, as: "visaType", attributes: ["id", "name"] }],
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
      return res.status(404).json({ status: "error", message: "No case found", data: null });
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
        case: { id: caseRecord.id, caseId: caseRecord.caseId, caseStage: caseRecord.caseStage },
        template: template ? { id: template.id, name: template.name, fields: template.fields } : null,
        submission: submission?.toJSON() ?? null,
      },
    });
  } catch (err) {
    console.error("getDataCaptureForm:", err);
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
      return res.status(404).json({ status: "error", message: "No case found", data: null });
    }

    let submission = await req.tenantDb.DataCaptureSubmission.findOne({
      where: { caseId: caseRecord.id },
    });
    if (!submission) {
      const template = await resolveTemplate(req.tenantDb, caseRecord.visaTypeId);
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
        return res.status(400).json({ status: "error", message: "Submission already approved", data: null });
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
    }

    res.status(200).json({
      status: "success",
      message: submit ? "Data Capture Sheet submitted" : "Draft saved",
      data: { submission },
    });
  } catch (err) {
    console.error("saveDataCaptureSubmission:", err);
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Caseworker: send DCS request + email + set stage */
export const sendDataCaptureRequest = async (req, res) => {
  try {
    const { caseId } = req.params;
    const caseRecord = await findCaseByRef(req.tenantDb, caseId);
    if (!caseRecord) {
      return res.status(404).json({ status: "error", message: "Case not found", data: null });
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

    const emailResult = await sendWorkflowStageEmail({
      tenantDb: req.tenantDb,
      caseRecord,
      stageId: "data_capture_initial_docs",
    });

    await recordTimelineEntry({
      tenantDb: req.tenantDb,
      caseId: caseRecord.id,
      actionType: "communication_sent",
      description: "Data Capture Sheet request sent to client",
      performedBy: req.user?.userId,
      metadata: { emailSent: emailResult.sent },
      visibility: "public",
    });

    res.status(200).json({
      status: "success",
      message: "Data Capture request sent",
      data: { case: caseRecord, submission, email: emailResult },
    });
  } catch (err) {
    console.error("sendDataCaptureRequest:", err);
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Caseworker: review DCS submission */
export const reviewDataCaptureSubmission = async (req, res) => {
  try {
    const { caseId } = req.params;
    const { status, reviewNotes } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ status: "error", message: "status must be approved or rejected", data: null });
    }

    const caseRecord = await findCaseByRef(req.tenantDb, caseId);
    if (!caseRecord) {
      return res.status(404).json({ status: "error", message: "Case not found", data: null });
    }

    const submission = await req.tenantDb.DataCaptureSubmission.findOne({
      where: { caseId: caseRecord.id },
    });
    if (!submission) {
      return res.status(404).json({ status: "error", message: "No submission found", data: null });
    }

    await submission.update({ status, reviewNotes: reviewNotes || null });

    if (status === "approved") {
      await applyCaseStageChange({
        tenantDb: req.tenantDb,
        caseRecord,
        nextStageId: "application_preparation",
        performedBy: req.user?.userId,
        reason: "Data Capture Sheet approved",
        sendEmail: false,
      });
    }

    res.status(200).json({ status: "success", data: { submission } });
  } catch (err) {
    console.error("reviewDataCaptureSubmission:", err);
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Caseworker: issue CCL */
export const issueCcl = async (req, res) => {
  try {
    const { caseId } = req.params;
    const { feeAmount, notes, documentId } = req.body;
    const caseRecord = await findCaseByRef(req.tenantDb, caseId);
    if (!caseRecord) {
      return res.status(404).json({ status: "error", message: "Case not found", data: null });
    }

    const [ccl] = await req.tenantDb.CaseCclRecord.findOrCreate({
      where: { caseId: caseRecord.id },
      defaults: { status: "pending" },
    });

    await ccl.update({
      status: "issued",
      feeAmount: feeAmount ?? caseRecord.totalAmount ?? ccl.feeAmount,
      issuedAt: new Date(),
      issuedBy: req.user?.userId,
      issuedDocumentId: documentId || ccl.issuedDocumentId,
      notes: notes || ccl.notes,
    });

    if (feeAmount != null) {
      await caseRecord.update({ totalAmount: feeAmount });
    }

    await applyCaseStageChange({
      tenantDb: req.tenantDb,
      caseRecord,
      nextStageId: "ccl_issued",
      performedBy: req.user?.userId,
      reason: "Client Care Letter issued",
      sendEmail: true,
    });

    res.status(200).json({ status: "success", data: { ccl, case: caseRecord } });
  } catch (err) {
    console.error("issueCcl:", err);
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** GET CCL status for case */
export const getCclStatus = async (req, res) => {
  try {
    const caseRef = req.params.caseId || req.query.caseId;
    const caseRecord = await findCaseByRef(req.tenantDb, caseRef);
    if (!caseRecord) {
      return res.status(404).json({ status: "error", message: "Case not found", data: null });
    }
    const ccl = await req.tenantDb.CaseCclRecord.findOne({ where: { caseId: caseRecord.id } });
    res.status(200).json({ status: "success", data: { ccl, caseId: caseRecord.caseId } });
  } catch (err) {
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
      return res.status(404).json({ status: "error", message: "No case found", data: null });
    }

    const ccl = await req.tenantDb.CaseCclRecord.findOne({ where: { caseId: caseRecord.id } });
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

    const paid = Number(caseRecord.paidAmount) || 0;
    const total = Number(caseRecord.totalAmount) || 0;
    if (total > 0 && paid >= total) {
      await applyCaseStageChange({
        tenantDb: req.tenantDb,
        caseRecord,
        nextStageId: "ccl_payment_received",
        performedBy: userId,
        reason: "Signed CCL and payment received",
        sendEmail: false,
      });
    }

    res.status(200).json({ status: "success", data: { ccl } });
  } catch (err) {
    console.error("confirmCclSigned:", err);
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Candidate: list decision documents for download */
export const getDecisionDocuments = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const caseRecord = await findCaseForUser(req.tenantDb, userId);
    if (!caseRecord) {
      return res.status(404).json({ status: "error", message: "No case found", data: null });
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
      attributes: ["id", "documentType", "documentName", "userFileName", "status", "created_at"],
    });

    res.status(200).json({
      status: "success",
      data: {
        unlocked,
        caseStage: stage,
        documents: docs,
        placeholders: [
          { type: "Decision Letter", available: unlocked && docs.some((d) => d.documentType === "Decision Letter") },
          { type: "Approval Notice", available: unlocked && docs.some((d) => d.documentType === "Approval Notice") },
          { type: "Visa Copy", available: unlocked && docs.some((d) => d.documentType === "Visa Copy") },
          { type: "BRP Information", available: unlocked && docs.some((d) => d.documentType === "BRP Information") },
        ],
      },
    });
  } catch (err) {
    console.error("getDecisionDocuments:", err);
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Caseworker: get workflow bundle for case detail */
export const getCaseWorkflowBundle = async (req, res) => {
  try {
    const caseRecord = await findCaseByRef(req.tenantDb, req.params.caseId);
    if (!caseRecord) {
      return res.status(404).json({ status: "error", message: "Case not found", data: null });
    }

    const [submission, ccl, template] = await Promise.all([
      req.tenantDb.DataCaptureSubmission.findOne({ where: { caseId: caseRecord.id } }),
      req.tenantDb.CaseCclRecord.findOne({ where: { caseId: caseRecord.id } }),
      resolveTemplate(req.tenantDb, caseRecord.visaTypeId),
    ]);

    res.status(200).json({
      status: "success",
      data: {
        caseStage: resolveCaseStage(caseRecord),
        dataCapture: { template, submission },
        ccl,
      },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};
