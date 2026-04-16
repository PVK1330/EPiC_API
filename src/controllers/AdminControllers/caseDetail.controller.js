import db from "../../models/index.js";
import { Op } from "sequelize";

const Case = db.Case;
const Document = db.Document;
const CasePayment = db.CasePayment;
const CaseTimeline = db.CaseTimeline;
const CaseCommunication = db.CaseCommunication;
const CaseNote = db.CaseNote;
const User = db.User;

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

    // Get main case details with all relationships
    const caseData = await Case.findOne({
      where: { id },
      include: [
        {
          model: User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'nationality']
        },
        {
          model: User,
          as: 'sponsor',
          attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'company_name']
        },
        {
          model: db.VisaType,
          as: 'visaType',
          attributes: ['id', 'name']
        },
        // {
        //   model: db.PetitionType,
        //   as: 'petitionType',
        //   attributes: ['id', 'name']
        // },
        {
          model: Document,
          as: 'documents',
          include: [
            {
              model: User,
              as: 'uploader',
              attributes: ['id', 'first_name', 'last_name']
            },
            {
              model: User,
              as: 'reviewer',
              attributes: ['id', 'first_name', 'last_name']
            }
          ],
          order: [['created_at', 'DESC']]
        },
        {
          model: CasePayment,
          as: 'payments',
          include: [
            {
              model: User,
              as: 'receiver',
              attributes: ['id', 'first_name', 'last_name']
            }
          ],
          order: [['paymentDate', 'DESC']]
        },
        {
          model: CaseTimeline,
          as: 'timeline',
          include: [
            {
              model: User,
              as: 'performer',
              attributes: ['id', 'first_name', 'last_name']
            }
          ],
          order: [['actionDate', 'DESC']]
        },
        {
          model: CaseCommunication,
          as: 'communications',
          include: [
            {
              model: User,
              as: 'sender',
              attributes: ['id', 'first_name', 'last_name']
            },
            {
              model: User,
              as: 'recipient',
              attributes: ['id', 'first_name', 'last_name']
            }
          ],
          order: [['created_at', 'DESC']]
        },
        {
          model: CaseNote,
          as: 'caseNotes',
          include: [
            {
              model: User,
              as: 'author',
              attributes: ['id', 'first_name', 'last_name']
            }
          ],
          order: [['created_at', 'DESC']]
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
    const caseworkers = await User.findAll({
      where: { id: caseworkerIds },
      attributes: ['id', 'first_name', 'last_name', 'email']
    });

    // Structure the response for frontend tabs
    const response = {
      status: "success",
      message: "Case details retrieved successfully",
      data: {
        // Overview Tab
        overview: {
          caseId: caseData.caseId,
          status: caseData.status,
          priority: caseData.priority,
          caseStage: caseData.caseStage,
          applicationType: caseData.applicationType,
          targetSubmissionDate: caseData.targetSubmissionDate,
          biometricsDate: caseData.biometricsDate,
          submissionDate: caseData.submissionDate,
          decisionDate: caseData.decisionDate,
          created_at: caseData.created_at,
          updated_at: caseData.updated_at
        },
        
        // Candidate Information
        candidate: caseData.candidate,
        
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
          nationality: caseData.nationality,
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
    const { status, caseStage, priority, assignedcaseworkerId, biometricsDate, submissionDate, decisionDate } = req.body;
    
    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "Case ID is required",
        data: null,
      });
    }

    const caseData = await Case.findByPk(id);
    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    // Update case with new values
    const updateData = {};
    if (status !== undefined) updateData.status = status;
    if (caseStage !== undefined) updateData.caseStage = caseStage;
    if (priority !== undefined) updateData.priority = priority;
    if (assignedcaseworkerId !== undefined) {
      const cwIds = Array.isArray(assignedcaseworkerId) ? assignedcaseworkerId : (assignedcaseworkerId ? [assignedcaseworkerId] : []);
      updateData.assignedcaseworkerId = cwIds;
    }
    if (biometricsDate !== undefined) updateData.biometricsDate = biometricsDate;
    if (submissionDate !== undefined) updateData.submissionDate = submissionDate;
    if (decisionDate !== undefined) updateData.decisionDate = decisionDate;

    await caseData.update(updateData);

    // Add timeline entry
    await CaseTimeline.create({
      caseId: id,
      actionType: 'status_changed',
      description: `Case status/stage updated`,
      performedBy: req.user?.id,
      previousValue: JSON.stringify({
        status: caseData.status,
        caseStage: caseData.caseStage,
        priority: caseData.priority
      }),
      newValue: JSON.stringify({
        status: status || caseData.status,
        caseStage: caseStage || caseData.caseStage,
        priority: priority || caseData.priority
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
