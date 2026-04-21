import db from "../../models/index.js";
import { sendRescheduleEmail } from "../../services/email.service.js";
import { generateRescheduleEmailTemplate } from "../../utils/emailTemplate.js";
import { ROLES } from "../../middlewares/role.middleware.js";

const Case = db.Case;
const User = db.User;
const RescheduleHistory = db.RescheduleHistory;

// Reschedule case
export const rescheduleCase = async (req, res) => {
  try {
    const { id } = req.params;
    const userRoleId = req.user.role_id;

    // Verify user is a caseworker
    if (userRoleId !== ROLES.CASEWORKER) {
      return res.status(403).json({
        status: "error",
        message: "Access denied. Only caseworkers can reschedule cases.",
        data: null,
      });
    }

    const { 
      targetSubmissionDate, 
      biometricsDate, 
      submissionDate, 
      decisionDate,
      reason
    } = req.body;

    const caseData = await Case.findByPk(id);
    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    // Track what fields are being changed
    const changes = [];
    if (targetSubmissionDate && targetSubmissionDate !== caseData.targetSubmissionDate) {
      changes.push({
        field: "Target Submission Date",
        oldValue: caseData.targetSubmissionDate,
        newValue: targetSubmissionDate,
        reason
      });
    }
    if (biometricsDate && biometricsDate !== caseData.biometricsDate) {
      changes.push({
        field: "Biometrics Date",
        oldValue: caseData.biometricsDate,
        newValue: biometricsDate,
        reason
      });
    }
    if (submissionDate && submissionDate !== caseData.submissionDate) {
      changes.push({
        field: "Submission Date",
        oldValue: caseData.submissionDate,
        newValue: submissionDate,
        reason
      });
    }
    if (decisionDate && decisionDate !== caseData.decisionDate) {
      changes.push({
        field: "Decision Date",
        oldValue: caseData.decisionDate,
        newValue: decisionDate,
        reason
      });
    }

    if (changes.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "No changes detected. At least one date must be different from the current value.",
        data: null,
      });
    }

    // Update the case with new dates
    await caseData.update({
      targetSubmissionDate: targetSubmissionDate || caseData.targetSubmissionDate,
      biometricsDate: biometricsDate || caseData.biometricsDate,
      submissionDate: submissionDate || caseData.submissionDate,
      decisionDate: decisionDate || caseData.decisionDate,
    });

    // Save reschedule history
    const createdById = req.user.userId;
    for (const change of changes) {
      await RescheduleHistory.create({
        caseId: caseData.id,
        fieldName: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        reason: change.reason,
        createdById,
      });
    }

    // Get candidate and sponsor for email notification
    const candidate = await User.findByPk(caseData.candidateId);
    const sponsor = await User.findByPk(caseData.sponsorId);

    // Send email to candidate
    if (candidate && candidate.email) {
      const emailHtml = generateRescheduleEmailTemplate(caseData, changes, candidate.first_name);
      await sendRescheduleEmail({
        to: candidate.email,
        html: emailHtml,
      });
    }

    // Send email to sponsor
    if (sponsor && sponsor.email && sponsor.email !== candidate?.email) {
      const emailHtml = generateRescheduleEmailTemplate(caseData, changes, sponsor.first_name);
      await sendRescheduleEmail({
        to: sponsor.email,
        html: emailHtml,
      });
    }

    res.status(200).json({
      status: "success",
      message: "Case rescheduled successfully. Notification emails sent.",
      data: {
        case: caseData,
        changes,
        emailsSent: [
          ...(candidate?.email ? [candidate.email] : []),
          ...(sponsor?.email && sponsor.email !== candidate?.email ? [sponsor.email] : []),
        ],
      },
    });
  } catch (error) {
    console.error("Reschedule Case Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get reschedule history for a case
export const getRescheduleHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const userRoleId = req.user.role_id;

    // Verify user is a caseworker
    if (userRoleId !== ROLES.CASEWORKER) {
      return res.status(403).json({
        status: "error",
        message: "Access denied. Only caseworkers can view reschedule history.",
        data: null,
      });
    }

    const history = await RescheduleHistory.findAll({
      where: { caseId: id },
      include: [
        {
          model: User,
          as: 'createdBy',
          attributes: ['id', 'first_name', 'last_name', 'email'],
        },
      ],
      order: [['created_at', 'DESC']],
    });

    res.status(200).json({
      status: "success",
      message: "Reschedule history retrieved successfully",
      data: history,
    });
  } catch (error) {
    console.error("Get Reschedule History Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};
