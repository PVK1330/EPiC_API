import { Op } from 'sequelize';
import { localDateStr } from '../../../utils/dateHelpers.js';
import { ROLES } from '../../../middlewares/role.middleware.js';
import {
  submitCclFeeProposal,
  reviewCclFeeProposal,
} from '../../../services/cclFeeProposal.service.js';
import { syncCclReleaseForApprovedFees } from '../../../services/cclCandidateRelease.service.js';
import { evaluateCaseStageAfterEvent, applyCaseStageChange } from '../../../services/caseStageAutomation.service.js';
import { bookBiometricDirect } from '../../../services/caseWorkflowProcess.service.js';
import { recordTimelineEntry } from '../../../services/caseTimeline.service.js';
import {
  assertSubmissionGate,
  resolveCaseStage,
  getStepById,
  normalizeCaseStage,
  isValidCaseStage,
} from '../../../constants/immigrationCaseProcess.js';

const MANUAL_PAYMENT_METHOD_MAP = {
  bank_transfer: 'bank_transfer',
  'bank transfer': 'bank_transfer',
  card: 'credit_card',
  credit_card: 'credit_card',
  cheque: 'check',
  check: 'check',
  cash: 'cash',
  online: 'online',
};

function resolvePaymentMethodEnum(input) {
  const key = String(input || 'bank_transfer').trim().toLowerCase();
  if (MANUAL_PAYMENT_METHOD_MAP[key]) return MANUAL_PAYMENT_METHOD_MAP[key];
  if (key.includes('bank')) return 'bank_transfer';
  if (key.includes('card')) return 'credit_card';
  if (key.includes('cheque') || key.includes('check')) return 'check';
  if (key.includes('cash')) return 'cash';
  return 'online';
}

const buildFullCaseIncludes = (tenantDb) => [
  {
    model: tenantDb.User,
    as: "candidate",
    attributes: ["id", "first_name", "last_name", "email", "mobile"],
    required: false,
  },
  {
    model: tenantDb.User,
    as: "sponsor",
    attributes: ["id", "first_name", "last_name", "email", "mobile"],
    required: false,
  },
  {
    model: tenantDb.VisaType,
    as: "visaType",
    attributes: ["id", "name"],
    required: false,
  },
  {
    model: tenantDb.Department,
    as: "department",
    attributes: ["id", "name"],
    required: false,
  },
  {
    model: tenantDb.Document,
    as: "documents",
    include: [
      {
        model: tenantDb.User,
        as: "uploader",
        attributes: ["first_name", "last_name"],
      },
    ],
    required: false,
  },
  {
    model: tenantDb.CasePayment,
    as: "payments",
    include: [
      {
        model: tenantDb.User,
        as: "receiver",
        attributes: ["first_name", "last_name"],
      },
    ],
    required: false,
  },
  {
    model: tenantDb.CaseTimeline,
    as: "timeline",
    include: [
      {
        model: tenantDb.User,
        as: "performer",
        attributes: ["first_name", "last_name"],
      },
    ],
    required: false,
  },
  {
    model: tenantDb.CaseCommunication,
    as: "communications",
    include: [
      {
        model: tenantDb.User,
        as: "sender",
        attributes: ["first_name", "last_name"],
      },
      {
        model: tenantDb.User,
        as: "recipient",
        attributes: ["first_name", "last_name"],
      },
    ],
    required: false,
  },
  {
    model: tenantDb.CaseNote,
    as: "caseNotes",
    include: [
      {
        model: tenantDb.User,
        as: "author",
        attributes: ["first_name", "last_name"],
      },
    ],
    required: false,
  },
  {
    model: tenantDb.Task,
    as: "tasks",
    include: [
      {
        model: tenantDb.User,
        as: "assignee",
        attributes: ["first_name", "last_name"],
      },
    ],
    required: false,
  },
];

const fetchFullCaseData = async (tenantDb, id) => {
  const whereClause = isNaN(id) ? { caseId: id } : { id: parseInt(id) };
  return tenantDb.Case.findOne({
    where: whereClause,
    include: buildFullCaseIncludes(tenantDb),
  });
};

// Get comprehensive case details for single case page
export const getCaseDetails = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "Case ID is required",
        data: null,
      });
    }

    // Support both numeric PK (id) and human-readable case reference (caseId e.g. CAS-000001)
    const whereClause = isNaN(id) ? { caseId: id } : { id: parseInt(id) };

    // Get main case details with all relationships
    const caseData = await req.tenantDb.Case.findOne({
      where: whereClause,
      include: [
        {
          model: req.tenantDb.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email', 'mobile'],
          required: false,
          include: [
            {
              model: req.tenantDb.CandidateApplication,
              as: 'application',
              required: false,
              attributes: ['id', 'dob', 'nationality', 'passportNumber', 'visaType', 'visaEndDate'],
            },
          ],
        },
        {
          model: req.tenantDb.User,
          as: 'sponsor',
          attributes: ['id', 'first_name', 'last_name', 'email', 'mobile'],
          required: false,
          include: [
            {
              model: req.tenantDb.SponsorProfile,
              as: 'sponsorProfile',
              required: false,
              attributes: ['id', 'companyName', 'sponsorLicenceNumber', 'licenceStatus', 'licenceExpiryDate'],
            },
          ],
        },
        {
          model: req.tenantDb.VisaType,
          as: 'visaType',
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: req.tenantDb.PetitionType,
          as: 'petitionType',
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: req.tenantDb.Document,
          as: 'documents',
          include: [
            {
              model: req.tenantDb.User,
              as: 'uploader',
              attributes: ['id', 'first_name', 'last_name'],
              required: false
            },
            {
              model: req.tenantDb.User,
              as: 'reviewer',
              attributes: ['id', 'first_name', 'last_name'],
              required: false
            }
          ],
          order: [['created_at', 'DESC']],
          required: false
        },
        {
          model: req.tenantDb.CasePayment,
          as: 'payments',
          include: [
            {
              model: req.tenantDb.User,
              as: 'receiver',
              attributes: ['id', 'first_name', 'last_name'],
              required: false
            }
          ],
          order: [['paymentDate', 'DESC']],
          required: false
        },
        {
          model: req.tenantDb.CaseTimeline,
          as: 'timeline',
          include: [
            {
              model: req.tenantDb.User,
              as: 'performer',
              attributes: ['id', 'first_name', 'last_name'],
              required: false
            }
          ],
          order: [['actionDate', 'DESC']],
          required: false
        },
        {
          model: req.tenantDb.CaseCommunication,
          as: 'communications',
          include: [
            {
              model: req.tenantDb.User,
              as: 'sender',
              attributes: ['id', 'first_name', 'last_name'],
              required: false
            },
            {
              model: req.tenantDb.User,
              as: 'recipient',
              attributes: ['id', 'first_name', 'last_name'],
              required: false
            }
          ],
          order: [['created_at', 'DESC']],
          required: false
        },
        {
          model: req.tenantDb.CaseNote,
          as: 'caseNotes',
          include: [
            {
              model: req.tenantDb.User,
              as: 'author',
              attributes: ['id', 'first_name', 'last_name'],
              required: false
            }
          ],
          order: [['created_at', 'DESC']],
          required: false
        }
      ]
    });

    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    // Calculate payment summary
    const totalFee = caseData.totalAmount;
    const totalPaid = caseData.payments.reduce((sum, payment) => {
      return payment.paymentStatus === 'completed' ? sum + parseFloat(payment.amount) : sum;
    }, 0);
    const outstandingBalance = totalFee - totalPaid;

    // Calculate document summary
    const documentSummary = {
      total: caseData.documents.length,
      missing: caseData.documents.filter(doc => doc.status === 'missing').length,
      uploaded: caseData.documents.filter(doc => doc.status === 'uploaded').length,
      underReview: caseData.documents.filter(doc => doc.status === 'under_review').length,
      approved: caseData.documents.filter(doc => doc.status === 'approved').length,
      rejected: caseData.documents.filter(doc => doc.status === 'rejected').length
    };

    // Get assigned caseworkers details
    const caseworkerIds = caseData.assignedcaseworkerId || [];
    const caseworkers = await req.tenantDb.User.findAll({
      where: { id: caseworkerIds },
      attributes: ['id', 'first_name', 'last_name', 'email']
    });

    // Structure the response for frontend tabs
    const response = {
      status: "success",
      message: "Case details retrieved successfully",
      data: {
        // DB primary key (for APIs that require numeric case_id, e.g. task create)
        internalId: caseData.id,

        // Overview Tab
        overview: {
          caseId: caseData.caseId,
          status: caseData.status,
          priority: caseData.priority,
          caseStage: caseData.caseStage,
          applicationType: caseData.applicationType,
          targetSubmissionDate: caseData.targetSubmissionDate,
          biometricsDate: caseData.biometricsDate,
          biometricLocation: caseData.biometricLocation,
          biometricTime: caseData.biometricTime,
          biometricDay: caseData.biometricDay,
          proposedAmount: caseData.proposedAmount,
          submissionDate: caseData.submissionDate,
          decisionDate: caseData.decisionDate,
          created_at: caseData.created_at,
          updated_at: caseData.updated_at
        },
        
        // Candidate Information — include nested application fields (dob, nationality, passport)
        candidate: caseData.candidate
          ? {
              ...caseData.candidate.toJSON(),
              dob: caseData.candidate.application?.dob || null,
              nationality: caseData.candidate.application?.nationality || null,
              passport_number: caseData.candidate.application?.passportNumber || null,
              visaEndDate: caseData.candidate.application?.visaEndDate || null,
              visaType: caseData.candidate.application?.visaType || null,
            }
          : null,
        
        // Business Information
        business: {
          businessId: caseData.businessId,
          sponsor: caseData.sponsor
        },
        
        // Visa and Petition Types
        visaType: caseData.visaType,
        // petitionType: caseData.petitionType,
        
        // Assigned Caseworkers
        caseworkers: caseworkers,
        
        // Key Dates
        keyDates: {
          submitted: caseData.submitted,
          targetSubmissionDate: caseData.targetSubmissionDate,
          biometricsDate: caseData.biometricsDate,
          submissionDate: caseData.submissionDate,
          decisionDate: caseData.decisionDate
        },
        
        // Financial Information
        financial: {
          totalFee: totalFee,
          totalPaid: totalPaid,
          outstandingBalance: outstandingBalance,
          salaryOffered: caseData.salaryOffered,
          amountStatus: caseData.amountStatus || 'Not Submitted',
          amountNotes: caseData.amountNotes || '',
          payments: caseData.payments
        },
        
        // Documents Tab
        documents: {
          summary: documentSummary,
          list: caseData.documents
        },
        
        // Timeline Tab
        timeline: caseData.timeline,
        
        // Communication Tab
        communications: caseData.communications,
        
        // Notes Tab
        notes: caseData.caseNotes.filter(note => !note.isArchived),
        
        // Additional case details
        additional: {
          lcaNumber: caseData.lcaNumber,
          receiptNumber: caseData.receiptNumber,
          jobTitle: caseData.jobTitle,
          department: caseData.department,
          notes: caseData.notes
        }
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Get Case Details Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Update case status and stage (for Overview tab actions)
export const updateCaseStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status,
      caseStage,
      priority,
      assignedcaseworkerId,
      biometricsDate,
      submissionDate,
      decisionDate,
      biometricLocation,
      biometricDate,
      biometricTime,
      biometricDay,
      biometricInstructions,
    } = req.body;
    
    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "Case ID is required",
        data: null,
      });
    }

    // Support both numeric PK (id) and human-readable case reference (caseId e.g. CAS-000001)
    const whereClause = isNaN(id) ? { caseId: id } : { id: parseInt(id) };
    const caseData = await req.tenantDb.Case.findOne({ where: whereClause });
    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    const previousStage = resolveCaseStage(caseData);
    let nextStage = caseStage !== undefined ? normalizeCaseStage(caseStage) : undefined;

    if (nextStage !== undefined && nextStage !== previousStage) {
      if (!isValidCaseStage(nextStage)) {
        return res.status(400).json({
          status: "error",
          message: "Valid caseStage is required",
          data: null,
        });
      }

      const gate = await assertSubmissionGate(req.tenantDb, caseData, nextStage);
      if (!gate.ok) {
        return res.status(400).json({
          status: "error",
          message: gate.message,
          data: null,
        });
      }
    }

    const previousState = {
      status: caseData.status,
      caseStage: caseData.caseStage,
      priority: caseData.priority
    };

    // Update case with other new values
    const updateData = {};
    if (status !== undefined && (nextStage === undefined || nextStage === previousStage)) updateData.status = status;
    if (caseStage !== undefined && (nextStage === undefined || nextStage === previousStage)) updateData.caseStage = caseStage;
    if (priority !== undefined) updateData.priority = priority;
    if (assignedcaseworkerId !== undefined) {
      const cwIds = Array.isArray(assignedcaseworkerId) ? assignedcaseworkerId : (assignedcaseworkerId ? [assignedcaseworkerId] : []);
      updateData.assignedcaseworkerId = cwIds;
    }
    if (biometricsDate !== undefined) updateData.biometricsDate = biometricsDate;
    if (submissionDate !== undefined) updateData.submissionDate = submissionDate;
    if (decisionDate !== undefined) updateData.decisionDate = decisionDate;

    if (Object.keys(updateData).length > 0) {
      await caseData.update(updateData);
    }

    if (
      nextStage === "biometrics_booked" &&
      (biometricLocation || biometricDate || biometricTime)
    ) {
      const bookResult = await bookBiometricDirect({
        tenantDb: req.tenantDb,
        caseRecord: caseData,
        location: biometricLocation,
        appointmentDate: biometricDate || biometricsDate,
        appointmentDay: biometricDay,
        appointmentTime: biometricTime,
        instructions: biometricInstructions,
        performedBy: req.user?.userId ?? req.user?.id,
        organisationId: req.user?.organisation_id ?? null,
      });
      if (!bookResult.ok) {
        return res.status(bookResult.status || 400).json({
          status: "error",
          message: bookResult.message,
          data: null,
        });
      }
      await caseData.reload();
    } else if (nextStage !== undefined && nextStage !== previousStage) {
      if (nextStage === "biometrics_booked" && !caseData.biometricsDate) {
        await caseData.update({ biometricsDate: new Date() });
      }
      await applyCaseStageChange({
        tenantDb: req.tenantDb,
        caseRecord: caseData,
        nextStageId: nextStage,
        performedBy: req.user?.userId ?? req.user?.id,
        reason: `Workflow moved to: ${getStepById(nextStage)?.title || nextStage}`,
        sendEmail: true,
        organisationId: req.user?.organisation_id ?? null,
      });
      await caseData.reload();
    }

    // Add timeline entry
    await req.tenantDb.CaseTimeline.create({
      caseId: caseData.id,
      actionType: 'status_changed',
      description: `Case status/stage updated`,
      performedBy: req.user?.id,
      previousValue: JSON.stringify(previousState),
      newValue: JSON.stringify({
        status: status || previousState.status,
        caseStage: caseStage || previousState.caseStage,
        priority: priority || previousState.priority
      })
    });

    res.status(200).json({
      status: "success",
      message: "Case status updated successfully",
      data: { case: caseData }
    });
  } catch (error) {
    console.error("Update Case Status Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Update case finance proposed amount and approval status
export const updateCaseFinance = async (req, res) => {
  try {
    const { id } = req.params;
    const { totalAmount, amountStatus, amountNotes } = req.body;
    const roleId = Number(req.user?.role_id);
    const userId = req.user?.userId ?? req.user?.id;
    const organisationId =
      req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;

    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "Case ID is required",
        data: null,
      });
    }

    const whereClause = isNaN(id) ? { caseId: id } : { id: parseInt(id) };
    const caseData = await req.tenantDb.Case.findOne({ where: whereClause });
    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    const fee = totalAmount !== undefined ? Number.parseFloat(totalAmount) : Number(caseData.totalAmount);

    // Caseworker: submit for approval → full CCL workflow (tasks + admin notifications)
    if (amountStatus === "Pending Approval") {
      const result = await submitCclFeeProposal({
        tenantDb: req.tenantDb,
        caseRecord: caseData,
        feeAmount: fee,
        installments: [{ label: "Full fee", amount: fee, dueDate: null }],
        notes: amountNotes ?? caseData.amountNotes,
        proposedBy: userId,
        organisationId,
        allowFromAnyStage: true,
      });

      if (!result.ok) {
        return res.status(result.status || 400).json({
          status: "error",
          message: result.message,
          data: null,
        });
      }

      return res.status(200).json({
        status: "success",
        message: "Fee proposal submitted for admin approval",
        data: {
          totalAmount: result.caseRecord.totalAmount,
          amountStatus: result.caseRecord.amountStatus,
          amountNotes: result.caseRecord.amountNotes,
          caseStage: result.caseRecord.caseStage,
        },
      });
    }

    // Admin: legacy approve/reject buttons → CCL review when a proposal exists
    if (roleId === ROLES.ADMIN && (amountStatus === "Approved" || amountStatus === "Rejected")) {
      let ccl = await req.tenantDb.CaseCclRecord.findOne({ where: { caseId: caseData.id } });

      // Backfill CCL record for cases stuck on legacy "Pending Approval" without workflow sync
      if (
        !ccl &&
        caseData.amountStatus === "Pending Approval" &&
        amountStatus === "Approved" &&
        fee > 0
      ) {
        await submitCclFeeProposal({
          tenantDb: req.tenantDb,
          caseRecord: caseData,
          feeAmount: fee,
          installments: [{ label: "Full fee", amount: fee, dueDate: null }],
          notes: caseData.amountNotes,
          proposedBy: userId,
          organisationId,
          allowFromAnyStage: true,
        });
        ccl = await req.tenantDb.CaseCclRecord.findOne({ where: { caseId: caseData.id } });
      }

      if (ccl?.status === "fee_proposed") {
        const result = await reviewCclFeeProposal({
          tenantDb: req.tenantDb,
          caseRecord: caseData,
          action: amountStatus === "Approved" ? "approve" : "reject",
          reviewNotes: amountNotes || null,
          reviewedBy: userId,
          organisationId,
        });

        if (!result.ok) {
          return res.status(result.status || 400).json({
            status: "error",
            message: result.message,
            data: null,
          });
        }

        return res.status(200).json({
          status: "success",
          message:
            amountStatus === "Approved"
              ? "Fees approved and CCL sent to client"
              : "Fee proposal returned to caseworker",
          data: {
            totalAmount: result.caseRecord.totalAmount,
            amountStatus: result.caseRecord.amountStatus,
            amountNotes: result.caseRecord.amountNotes,
            caseStage: result.caseRecord.caseStage,
          },
        });
      }

      if (amountStatus === "Approved") {
        const sync = await syncCclReleaseForApprovedFees({
          tenantDb: req.tenantDb,
          caseRecord: caseData,
          performedBy: userId,
          organisationId,
        });
        if (sync.ccl) {
          await caseData.reload();
          return res.status(200).json({
            status: "success",
            message: "Fees approved and CCL sent to client",
            data: {
              totalAmount: caseData.totalAmount,
              amountStatus: caseData.amountStatus,
              amountNotes: caseData.amountNotes,
              caseStage: caseData.caseStage,
            },
          });
        }
      }
    }

    if (amountStatus === 'Paid') {
      if (roleId !== ROLES.ADMIN) {
        return res.status(403).json({
          status: 'error',
          message: 'Only administrators can mark a case payment status as Paid',
          data: null,
        });
      }

      const totalFee = Number.parseFloat(caseData.totalAmount) || 0;
      const prevPaid = Number.parseFloat(caseData.paidAmount) || 0;
      const balanceDue = Math.max(0, totalFee - prevPaid);

      if (balanceDue > 0.02) {
        const invoiceNumber = `ADM-${Date.now()}`;
        await req.tenantDb.CasePayment.create({
          caseId: caseData.id,
          paymentType: 'fee',
          amount: balanceDue,
          paymentMethod: 'bank_transfer',
          paymentDate: localDateStr(),
          paymentStatus: 'completed',
          transactionId: invoiceNumber,
          invoiceNumber,
          description: 'Marked as paid by administrator',
          receivedBy: userId || null,
        });
      }

      await caseData.update({
        paidAmount: totalFee > 0 ? totalFee : prevPaid,
        amountStatus: 'Paid',
      });
      await caseData.reload();

      await evaluateCaseStageAfterEvent({
        tenantDb: req.tenantDb,
        caseRecord: caseData,
        trigger: 'payment_received',
        performedBy: userId || null,
        organisationId,
      }).catch((err) => console.error('evaluateCaseStageAfterEvent:', err));

      await recordTimelineEntry({
        tenantDb: req.tenantDb,
        caseId: caseData.id,
        actionType: 'payment_received',
        description: 'Payment status set to Paid by administrator',
        performedBy: userId,
        visibility: 'internal',
      });

      return res.status(200).json({
        status: 'success',
        message: 'Case marked as paid',
        data: {
          totalAmount: caseData.totalAmount,
          paidAmount: caseData.paidAmount,
          amountStatus: caseData.amountStatus,
          amountNotes: caseData.amountNotes,
        },
      });
    }

    if (roleId !== ROLES.ADMIN) {
      if (
        amountStatus !== undefined &&
        amountStatus !== 'Pending Approval'
      ) {
        return res.status(403).json({
          status: 'error',
          message:
            'Caseworkers cannot set payment status directly. Use "Submit CCL fees for approval" to send amounts to admin.',
          data: null,
        });
      }

      const draftUpdate = {};
      if (totalAmount !== undefined) draftUpdate.totalAmount = totalAmount;
      if (amountNotes !== undefined) draftUpdate.amountNotes = amountNotes;
      if (Object.keys(draftUpdate).length === 0) {
        return res.status(400).json({
          status: 'error',
          message: 'No finance fields to update',
          data: null,
        });
      }

      await caseData.update(draftUpdate);
      await caseData.reload();

      return res.status(200).json({
        status: 'success',
        message: 'Draft fee details saved',
        data: {
          totalAmount: caseData.totalAmount,
          amountStatus: caseData.amountStatus,
          amountNotes: caseData.amountNotes,
        },
      });
    }

    const updateData = {};
    if (totalAmount !== undefined) updateData.totalAmount = totalAmount;
    if (amountStatus !== undefined) updateData.amountStatus = amountStatus;
    if (amountNotes !== undefined) updateData.amountNotes = amountNotes;

    await caseData.update(updateData);
    await caseData.reload();

    if (roleId === ROLES.ADMIN && amountStatus === "Approved") {
      await syncCclReleaseForApprovedFees({
        tenantDb: req.tenantDb,
        caseRecord: caseData,
        performedBy: userId,
        organisationId,
      });
      await caseData.reload();
    }

    await req.tenantDb.CaseTimeline.create({
      caseId: caseData.id,
      actionType: "case_updated",
      description: `Case finance details updated (${amountStatus || caseData.amountStatus})`,
      performedBy: userId,
      previousValue: JSON.stringify({
        totalAmount: caseData.totalAmount,
        amountStatus: caseData.amountStatus,
      }),
      newValue: JSON.stringify({
        totalAmount: totalAmount ?? caseData.totalAmount,
        amountStatus: amountStatus ?? caseData.amountStatus,
      }),
    });

    res.status(200).json({
      status: "success",
      message: "Case finance updated successfully",
      data: {
        totalAmount: caseData.totalAmount,
        amountStatus: caseData.amountStatus,
        amountNotes: caseData.amountNotes,
      },
    });
  } catch (error) {
    console.error("Update Case Finance Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

/** Record a manual payment (admin only) and mark as completed */
export const recordManualCasePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, paymentMethod, description, markFullyPaid, notes } = req.body;
    const roleId = Number(req.user?.role_id);
    const userId = req.user?.userId ?? req.user?.id;
    const organisationId =
      req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;

    if (roleId !== ROLES.ADMIN) {
      return res.status(403).json({
        status: 'error',
        message:
          'Only administrators can record payments or mark a case as paid. Caseworkers should submit fee proposals for admin approval.',
        data: null,
      });
    }

    if (!id) {
      return res.status(400).json({
        status: 'error',
        message: 'Case ID is required',
        data: null,
      });
    }

    const whereClause = Number.isNaN(Number(id)) ? { caseId: id } : { id: parseInt(id, 10) };
    const caseData = await req.tenantDb.Case.findOne({ where: whereClause });
    if (!caseData) {
      return res.status(404).json({
        status: 'error',
        message: 'Case not found',
        data: null,
      });
    }

    const totalFee = Number.parseFloat(caseData.totalAmount) || 0;
    const prevPaid = Number.parseFloat(caseData.paidAmount) || 0;
    const balanceDue = Math.max(0, totalFee - prevPaid);

    let payAmount = markFullyPaid
      ? balanceDue
      : Number.parseFloat(amount) || 0;

    if (payAmount <= 0) {
      return res.status(400).json({
        status: 'error',
        message: markFullyPaid
          ? 'Case is already fully paid or has no fee total set'
          : 'Payment amount must be greater than zero',
        data: null,
      });
    }

    const methodEnum = resolvePaymentMethodEnum(paymentMethod);
    const paymentDate = localDateStr();
    const invoiceNumber = `MAN-${Date.now()}`;

    const payment = await req.tenantDb.CasePayment.create({
      caseId: caseData.id,
      paymentType: 'fee',
      amount: payAmount,
      paymentMethod: methodEnum,
      paymentDate,
      paymentStatus: 'completed',
      transactionId: invoiceNumber,
      invoiceNumber,
      description: description || (markFullyPaid ? 'Manual payment — marked fully paid' : 'Manual payment recorded'),
      notes: notes || null,
      receivedBy: userId || null,
    });

    const newPaid = prevPaid + payAmount;
    const balanceAfter = Math.max(0, totalFee - newPaid);
    const financeUpdates = { paidAmount: newPaid };
    if (balanceAfter <= 0.02 && totalFee > 0) {
      financeUpdates.amountStatus = 'Paid';
    }
    await caseData.update(financeUpdates);
    await caseData.reload();

    await evaluateCaseStageAfterEvent({
      tenantDb: req.tenantDb,
      caseRecord: caseData,
      trigger: 'payment_received',
      performedBy: userId || null,
      organisationId,
    }).catch((err) => console.error('evaluateCaseStageAfterEvent:', err));

    await recordTimelineEntry({
      tenantDb: req.tenantDb,
      caseId: caseData.id,
      actionType: 'payment_received',
      description: `Manual payment recorded: £${payAmount.toFixed(2)}${markFullyPaid ? ' (fully paid)' : ''}`,
      performedBy: userId,
      metadata: {
        amount: payAmount,
        paymentMethod: methodEnum,
        paymentId: payment.id,
        markFullyPaid: Boolean(markFullyPaid),
      },
      visibility: 'internal',
    });

    res.status(200).json({
      status: 'success',
      message: markFullyPaid || balanceAfter === 0
        ? 'Payment recorded — case is fully paid'
        : 'Manual payment recorded successfully',
      data: {
        payment,
        paidAmount: newPaid,
        totalFee,
        balanceDue: balanceAfter,
        paymentStatus: balanceAfter === 0 ? 'Fully Paid' : 'Partially Paid',
      },
    });
  } catch (error) {
    console.error('Record Manual Case Payment Error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null,
      error: error.message,
    });
  }
};

// Export Case Details to CSV
export const exportCaseCSV = async (req, res) => {
  try {
    const { id } = req.params;
    const caseData = await fetchFullCaseData(req.tenantDb, id);

    if (!caseData) return res.status(404).json({ status: "error", message: "Case not found" });

    let csv = "\uFEFF"; // BOM for Excel
    const esc = (v) => `"${String(v || "").replace(/"/g, '""')}"`;

    // Section 1: Overview
    csv += "SECTION,FIELD,VALUE\n";
    csv += `INFO,Case ID,${esc(caseData.caseId)}\n`;
    csv += `INFO,Status,${esc(caseData.status)}\n`;
    csv += `INFO,Workflow Stage,${esc(caseData.caseStage)}\n`;
    csv += `INFO,Candidate,${esc(caseData.candidate?.first_name + " " + caseData.candidate?.last_name)}\n`;
    csv += `INFO,Sponsor,${esc(caseData.sponsor?.first_name + " " + caseData.sponsor?.last_name)}\n`;
    csv += `INFO,Department,${esc(caseData.department?.name)}\n`;
    csv += `INFO,Visa Type,${esc(caseData.visaType?.name)}\n`;
    csv += `INFO,Job Title,${esc(caseData.jobTitle)}\n`;
    csv += `INFO,Target Date,${esc(caseData.targetSubmissionDate)}\n\n`;

    // Section 2: Tasks
    csv += "SECTION,TASK NAME,PRIORITY,STATUS,ASSIGNED TO,DUE DATE\n";
    (caseData.tasks || []).forEach(t => {
      csv += `TASK,${esc(t.title)},${esc(t.priority)},${esc(t.status)},${esc(t.assignee?.first_name)},${esc(t.due_date)}\n`;
    });
    csv += "\n";

    // Section 3: Financials
    csv += "SECTION,DATE,AMOUNT,METHOD,STATUS,INVOICE,RECORDED BY\n";
    (caseData.payments || []).forEach(p => {
      csv += `PAYMENT,${esc(p.paymentDate)},${esc(p.amount)},${esc(p.paymentMethod)},${esc(p.paymentStatus)},${esc(p.invoiceNumber)},${esc(p.receiver?.first_name)}\n`;
    });
    csv += "\n";

    // Section 4: Documents
    csv += "SECTION,DOC NAME,STATUS,UPLOADED AT,UPLOADED BY\n";
    (caseData.documents || []).forEach(d => {
      csv += `DOCUMENT,${esc(d.documentName)},${esc(d.status)},${esc(d.uploadedAt)},${esc(d.uploader?.first_name)}\n`;
    });
    csv += "\n";

    // Section 5: Communication
    csv += "SECTION,SENDER,RECIPIENT,SUBJECT,DATE\n";
    (caseData.communications || []).forEach(c => {
      csv += `COMM,${esc(c.sender?.first_name)},${esc(c.recipient?.first_name || c.recipientEmail)},${esc(c.subject)},${esc(c.created_at)}\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=Case_Full_Report_${caseData.caseId}.csv`);
    return res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

import PdfPrinter from 'pdfmake';

export const exportCasePDF = async (req, res) => {
  try {
    const { id } = req.params;
    const caseData = await fetchFullCaseData(req.tenantDb, id);
    if (!caseData) return res.status(404).json({ status: "error", message: "Case not found" });

    const fonts = {
      Roboto: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique'
      }
    };
    const printer = new PdfPrinter(fonts);

    const docDefinition = {
      pageMargins: [40, 40, 40, 40],
      content: [
        { text: `OFFICIAL CASE REPORT: ${caseData.caseId}`, style: 'header' },
        { 
          columns: [
            { text: `Candidate: ${caseData.candidate?.first_name} ${caseData.candidate?.last_name}`, bold: true },
            { text: `Export Date: ${new Date().toLocaleDateString()}`, alignment: 'right' }
          ]
        },
        { text: `Status: ${caseData.status} | Visa: ${caseData.visaType?.name || 'N/A'}`, margin: [0, 5, 0, 20] },
        
        { text: '1. Employment & Sponsorship', style: 'sectionHeader' },
        {
          table: {
            widths: ['30%', '70%'],
            body: [
              ['Sponsor Entity', caseData.sponsor?.first_name || 'N/A'],
              ['Department', caseData.department?.name || 'N/A'],
              ['Job Title', caseData.jobTitle || 'N/A'],
              ['Salary Offered', caseData.salaryOffered || 'N/A'],
              ['Target Submission', caseData.targetSubmissionDate || 'N/A']
            ]
          },
          margin: [0, 0, 0, 15]
        },

        { text: '2. Tasks & Action Items', style: 'sectionHeader' },
        {
          table: {
            headerRows: 1,
            widths: ['*', 'auto', 'auto', 'auto'],
            body: [
              [{text: 'Task', style: 'tableHeader'}, {text: 'Priority', style: 'tableHeader'}, {text: 'Status', style: 'tableHeader'}, {text: 'Due', style: 'tableHeader'}],
              ...(caseData.tasks || []).map(t => [t.title, t.priority, t.status, t.due_date || 'N/A'])
            ]
          },
          margin: [0, 0, 0, 15]
        },

        { text: '3. Financial Summary', style: 'sectionHeader' },
        {
          table: {
            headerRows: 1,
            widths: ['auto', '*', 'auto', 'auto'],
            body: [
              [{text: 'Date', style: 'tableHeader'}, {text: 'Ref / Invoice', style: 'tableHeader'}, {text: 'Amount', style: 'tableHeader'}, {text: 'Status', style: 'tableHeader'}],
              ...(caseData.payments || []).map(p => [p.paymentDate || 'N/A', p.invoiceNumber || 'N/A', p.amount, p.paymentStatus])
            ]
          },
          margin: [0, 0, 0, 15]
        },

        { text: '4. Documentation Status', style: 'sectionHeader' },
        {
          table: {
            headerRows: 1,
            widths: ['*', 'auto', 'auto'],
            body: [
              [{text: 'Document Name', style: 'tableHeader'}, {text: 'Status', style: 'tableHeader'}, {text: 'Upload Date', style: 'tableHeader'}],
              ...(caseData.documents || []).map(d => [d.documentName, d.status, d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString() : 'N/A'])
            ]
          },
          margin: [0, 0, 0, 15]
        },

        { text: '5. Recent Activity Log', style: 'sectionHeader' },
        {
          table: {
            headerRows: 1,
            widths: ['auto', '*', 'auto'],
            body: [
              [{text: 'Date', style: 'tableHeader'}, {text: 'Action', style: 'tableHeader'}, {text: 'User', style: 'tableHeader'}],
              ...(caseData.timeline || []).slice(0, 20).map(tl => [new Date(tl.actionDate).toLocaleDateString(), tl.description, tl.performer?.first_name || 'System'])
            ]
          },
          margin: [0, 0, 0, 15]
        },

        { text: '6. Internal Case Notes', style: 'sectionHeader' },
        ...(caseData.caseNotes || []).map(n => ({
          text: `[${new Date(n.created_at).toLocaleDateString()}] ${n.author?.first_name}: ${n.content}`,
          margin: [0, 2, 0, 2],
          fontSize: 9
        }))
      ],
      styles: {
        header: { fontSize: 24, bold: true, color: '#2563eb', margin: [0, 0, 0, 10] },
        sectionHeader: { fontSize: 14, bold: true, color: '#1e293b', margin: [0, 10, 0, 8], decoration: 'underline' },
        tableHeader: { bold: true, fontSize: 10, color: '#475569', fillColor: '#f8fafc' }
      },
      defaultStyle: { fontSize: 10 }
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Official_Case_Report_${caseData.caseId}.pdf`);
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) {
    console.error("PDF Export Error:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
};
