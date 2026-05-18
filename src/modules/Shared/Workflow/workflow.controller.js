import { Op } from "sequelize";
import { resolveCaseStage, STAGE_TO_LEGACY_STATUS } from "../../../constants/immigrationCaseProcess.js";
import { applyCaseStageChange } from "../../../services/caseStageAutomation.service.js";
import { sendWorkflowStageEmail } from "../../../services/workflowEmail.service.js";
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
  submitCclFeeProposal,
  reviewCclFeeProposal,
} from "../../../services/cclFeeProposal.service.js";

function organisationIdFromReq(req) {
  const id = req.user?.organisation_id;
  return id != null ? Number(id) : null;
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
      await applyCaseStageChange({
        tenantDb: req.tenantDb,
        caseRecord,
        nextStageId: "application_preparation",
        performedBy: userId,
        organisationId: organisationIdFromReq(req),
        reason: "Data Capture Sheet submitted by client",
        sendEmail: false,
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

/** Staff: fetch data capture sheet for a case */
export const getStaffDataCapture = async (req, res) => {
  try {
    const caseRecord = await findCaseByRef(req.tenantDb, req.params.caseId);
    if (!caseRecord) {
      return res.status(404).json({ status: "error", message: "Case not found", data: null });
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
    console.error("getStaffDataCapture:", err);
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
      organisationId: organisationIdFromReq(req),
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

    await createTasksOnDataCaptureSent({
      tenantDb: req.tenantDb,
      caseRecord,
      sentBy: req.user?.userId,
      organisationId: organisationIdFromReq(req),
    }).catch((err) => console.error("createTasksOnDataCaptureSent:", err));

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
      }).catch((err) => console.error("createTasksOnDataCaptureRejected:", err));
    }

    res.status(200).json({ status: "success", data: { submission } });
  } catch (err) {
    console.error("reviewDataCaptureSubmission:", err);
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
      return res.status(404).json({ status: "error", message: "Case not found", data: null });
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
      allowFromAnyStage: false,
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
    console.error("proposeCclFees:", err);
    res.status(500).json({ status: "error", message: err.message, data: null });
  }
};

/** Admin: approve or reject proposed CCL fees */
export const reviewCclFees = async (req, res) => {
  try {
    if (Number(req.user?.role_id) !== ROLES.ADMIN && Number(req.user?.role) !== ROLES.ADMIN) {
      return res.status(403).json({ status: "error", message: "Admin access required", data: null });
    }

    const { caseId } = req.params;
    const { action, reviewNotes } = req.body;
    const caseRecord = await findCaseByRef(req.tenantDb, caseId);
    if (!caseRecord) {
      return res.status(404).json({ status: "error", message: "Case not found", data: null });
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
    console.error("reviewCclFees:", err);
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
    if (Number(req.user?.role_id) !== ROLES.ADMIN && Number(req.user?.role) !== ROLES.ADMIN) {
      return res.status(403).json({ status: "error", message: "Admin access required", data: null });
    }

    const cases = await req.tenantDb.Case.findAll({
      where: { caseStage: "ccl_fee_admin_review" },
      include: [
        { model: req.tenantDb.User, as: "candidate", attributes: ["id", "first_name", "last_name", "email"] },
        { model: req.tenantDb.VisaType, as: "visaType", attributes: ["id", "name"] },
        { model: req.tenantDb.CaseCclRecord, as: "cclRecord", required: true },
      ],
      order: [["updated_at", "DESC"]],
    });

    res.status(200).json({ status: "success", data: { cases } });
  } catch (err) {
    console.error("listCclFeePendingApprovals:", err);
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

/** Candidate: accept Client Care Letter (checkbox confirmation) */
export const acceptCcl = async (req, res) => {
  try {
    const userId = req.user?.userId;
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

    const paid =
      caseRecord.amountStatus === "paid" ||
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
    console.error("acceptCcl:", err);
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
        organisationId: organisationIdFromReq(req),
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

/** Candidate: payment schedule (visible only after admin approves CCL fees) */
export const getCandidatePaymentSchedule = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const caseRecord = await findCaseForUser(req.tenantDb, userId);
    if (!caseRecord) {
      return res.status(404).json({ status: "error", message: "No case found", data: null });
    }

    const ccl = await req.tenantDb.CaseCclRecord.findOne({ where: { caseId: caseRecord.id } });
    const visibleStatuses = new Set(["issued", "signed", "accepted"]);
    const approved = ccl && visibleStatuses.has(ccl.status);

    if (!approved) {
      return res.status(200).json({
        status: "success",
        data: {
          visible: false,
          message: "Payment schedule will appear after your caseworker and admin approve your Client Care Letter fees.",
          caseId: caseRecord.caseId,
          cclStatus: ccl?.status || "pending",
        },
      });
    }

    const installments = Array.isArray(ccl.installmentPlan) ? ccl.installmentPlan : [];
    const totalFee = Number(ccl.feeAmount) || Number(caseRecord.totalAmount) || 0;
    const paidAmount = Number(caseRecord.paidAmount) || 0;

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
        ccl: {
          status: ccl.status,
          issuedAt: ccl.issuedAt,
          signedAt: ccl.signedAt,
        },
      },
    });
  } catch (err) {
    console.error("getCandidatePaymentSchedule:", err);
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
