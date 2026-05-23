import { Op } from 'sequelize';
import {
  notifyCaseAssigned,
  notifyCaseStatusChanged,
  notifyProposedAmountToCandidate,
} from '../../services/notification.service.js';
import {
  createTasksOnCaseworkerAssignment,
  createWorkflowTask,
  syncWorkflowTasksForStage,
  completePendingWorkflowTasks,
} from '../../services/workflowTaskAutomation.service.js';
import { generateCaseId } from '../../utils/case.utils.js';
import { mergeCaseWhere, assertUsersInOrganisation } from '../../utils/tenantScope.js';
import { recordAuditLog } from '../../services/audit.service.js';
import { recordCaseCreated, recordStatusChange, recordAssignmentChange, recordTimelineEntry } from '../../services/caseTimeline.service.js';
import { sendWorkflowStageEmail } from '../../services/workflowEmail.service.js';
import { applyAdminCclFeeOnCase } from '../../services/adminCclFeeSetup.service.js';
import {
  IMMIGRATION_CASE_STEPS,
  STAGE_GUIDANCE,
  assignCasesToPipeline,
  isValidCaseStage,
  getStepById,
  resolveCaseStage,
  STAGE_TO_LEGACY_STATUS,
  LEGACY_STATUS_TO_STAGE,
  DEFAULT_CASE_STAGE,
  assertSubmissionGate,
  normalizeCaseStage,
} from '../../constants/immigrationCaseProcess.js';
import { applyCaseStageChange } from '../../services/caseStageAutomation.service.js';
import { bookBiometricDirect } from '../../services/caseWorkflowProcess.service.js';


// Helper function to generate next case ID like #CAS-001 securely
// (Now using shared utility from ../../../../utils/case.utils.js)

// Create Case
export const createCase = async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({
        status: "error",
        message: "Request body is required",
        data: null,
      });
    }

    const {
      candidateId,              // INTEGER - Foreign key to users table
      sponsorId,                // INTEGER - Foreign key to users table
      businessId,               // INTEGER - Foreign key to users table (business/sponsor)
      visaTypeId,
      petitionTypeId,
      priority,
      targetSubmissionDate,
      lcaNumber,
      receiptNumber,
      assignedcaseworkerId,
      salaryOffered,
      totalAmount,
      paidAmount,
      notes,
      nationality,
      jobTitle,
      departmentId,
      proposedAmount,
    } = req.body;

    const cwIds = Array.isArray(assignedcaseworkerId) ? assignedcaseworkerId : (assignedcaseworkerId ? [assignedcaseworkerId] : []);
    const parsedProposedOnCreate = parseFloat(proposedAmount);

    // Field-wise validation
    const errors = [];
    
    if (candidateId === undefined || candidateId === null || candidateId === '') errors.push("candidateId is required");
    if (sponsorId === undefined || sponsorId === null || sponsorId === '') errors.push("sponsorId is required");
    if (visaTypeId === undefined || visaTypeId === null || visaTypeId === '') errors.push("visaTypeId is required");
    // Caseworker optional at creation — admin task prompts assignment
    if (targetSubmissionDate === undefined || targetSubmissionDate === null || targetSubmissionDate === '') errors.push("targetSubmissionDate is required");
    if (totalAmount === undefined || totalAmount === null) errors.push("totalAmount is required");

    if (errors.length > 0) {
      return res.status(400).json({
        status: "error",
        message: "Validation failed",
        data: { errors },
      });
    }

    // Check if candidate exists
    const candidate = await req.tenantDb.User.findByPk(candidateId);
    if (!candidate) {
      return res.status(404).json({
        status: "error",
        message: "Candidate not found",
        data: null,
      });
    }

    // Check if sponsor exists
    const sponsor = await req.tenantDb.User.findByPk(sponsorId);
    if (!sponsor) {
      return res.status(404).json({
        status: "error",
        message: "Sponsor not found",
        data: null,
      });
    }

    const organisationId = req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;
    try {
      await assertUsersInOrganisation(req.tenantDb, candidateId, sponsorId);
    } catch (tenantErr) {
      const code = tenantErr.status || 403;
      return res.status(code).json({
        status: "error",
        message: tenantErr.message || "Tenant validation failed",
        data: null,
      });
    }

    const caseId = await generateCaseId(req.tenantDb);

    const reqDeptId = req.body.departmentId !== undefined ? req.body.departmentId : req.body.department;
    const parsedDeptId = reqDeptId !== undefined && reqDeptId !== null && reqDeptId !== '' ? parseInt(reqDeptId, 10) : null;

    const newCase = await req.tenantDb.Case.create({
      caseId,
      organisation_id: organisationId,
      candidateId,
      sponsorId,
      visaTypeId,
      petitionTypeId: petitionTypeId || null,
      priority: priority || "medium",
      status: "Lead",
      caseStage: DEFAULT_CASE_STAGE,
      submitted: new Date(),
      targetSubmissionDate,
      lcaNumber: lcaNumber || null,
      receiptNumber: receiptNumber || null,
      nationality: nationality || null,
      jobTitle: jobTitle || null,
      departmentId: parsedDeptId,
      assignedcaseworkerId: cwIds.length > 0 ? cwIds : [],
      salaryOffered: salaryOffered || 0,
      totalAmount: totalAmount || 0,
      paidAmount: paidAmount || 0,
      notes: notes || "",
      businessId: businessId || sponsorId, // Ensure businessId is set
      proposedAmount:
        !Number.isNaN(parsedProposedOnCreate) && parsedProposedOnCreate >= 0
          ? parsedProposedOnCreate
          : null,
    });

    if (!Number.isNaN(parsedProposedOnCreate) && parsedProposedOnCreate > 0) {
      try {
        await applyAdminCclFeeOnCase({
          tenantDb: req.tenantDb,
          caseRecord: newCase,
          feeAmount: parsedProposedOnCreate,
          performedBy: req.user?.userId,
          organisationId,
          reviewNotes: "CCL fee set by administrator on case creation",
        });
        await newCase.reload();
      } catch (cclErr) {
        console.error("applyAdminCclFeeOnCase (createCase):", cclErr);
      }
    }

    // Admin task: review enquiry and assign caseworker (when case is unassigned)
    try {
      await syncWorkflowTasksForStage({
        tenantDb: req.tenantDb,
        caseRecord: newCase,
        stageId: DEFAULT_CASE_STAGE,
        performedBy: req.user?.userId,
        organisationId,
      });
    } catch (stageTaskErr) {
      console.error("syncWorkflowTasksForStage (createCase):", stageTaskErr);
    }

    // Send notifications to assigned caseworkers
    if (cwIds.length > 0) {
      // Fetch visa type name for notification
      const visaType = await req.tenantDb.VisaType.findByPk(visaTypeId);
      const visaTypeName = visaType ? visaType.name : 'Not specified';
      
      const caseData = {
        id: newCase.id,
        caseId: newCase.caseId,
        candidateName: `${candidate.first_name} ${candidate.last_name}`,
        visaType: visaTypeName,
      };
      for (const caseworkerId of cwIds) {
        try {
          await notifyCaseAssigned(req.tenantDb, caseworkerId, caseData);
        } catch (notifError) {
          console.error('Failed to send notification to caseworker:', caseworkerId, notifError);
        }
      }
      // Notify Client (Candidate & Sponsor)
      try {
          await notifyCaseStatusChanged(req.tenantDb, [candidateId, sponsorId], caseData, 'None', 'Assigned');
      } catch (notifError) {
          console.error('Failed to notify client of assignment:', notifError);
      }
      await createTasksOnCaseworkerAssignment({
        tenantDb: req.tenantDb,
        caseRecord: newCase,
        newCaseworkerIds: cwIds,
        assignedBy: req.user?.userId,
        organisationId,
        reason: notes || "Initial case creation assignment",
      }).catch((err) => console.error('createTasksOnCaseworkerAssignment:', err));
    }

    // Record Audit Log
    await recordAuditLog({
      tenantDb: req.tenantDb,
      userId: req.user?.userId,
      action: 'Case Created',
      resource: `Case ${newCase.caseId}`,
      status: 'Success',
      details: `New case created for candidate ${candidate.first_name} ${candidate.last_name}`,
      req,
    });

    // Record Timeline Entry
    await recordCaseCreated({
      tenantDb: req.tenantDb,
      caseId: newCase.id,
      performedBy: req.user?.userId,
      caseDetails: {
        caseId: newCase.caseId,
        candidateName: `${candidate.first_name} ${candidate.last_name}`,
        visaTypeId,
        priority,
      },
    });

    res.status(201).json({
      status: "success",
      message: "Case created successfully",
      data: { case: newCase },
    });
  } catch (error) {
    console.error("Create Case Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get Cases with Enhanced Filtering
export const getCasesWithFilters = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search, 
      status, 
      priority, 
      visaTypeId,
      petitionTypeId,
      candidateId,
      sponsorId
    } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = {};

    if (search) {
      whereClause[Op.or] = [
        { caseId: { [Op.iLike]: `%${search}%` } },
        { '$candidate.first_name$': { [Op.iLike]: `%${search}%` } },
        { '$candidate.last_name$': { [Op.iLike]: `%${search}%` } }
      ];
    }

    if (status) whereClause.status = status;
    if (priority) whereClause.priority = priority;
    if (visaTypeId) whereClause.visaTypeId = visaTypeId;
    if (petitionTypeId) whereClause.petitionTypeId = petitionTypeId;
    if (candidateId) whereClause.candidateId = candidateId;
    if (sponsorId) whereClause.sponsorId = sponsorId;

    const scopedWhere = mergeCaseWhere(req, whereClause);

    const { count, rows: cases } = await req.tenantDb.Case.findAndCountAll({
      where: scopedWhere,
      order: [["created_at", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset),
      include: [
        {
          model: req.tenantDb.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: req.tenantDb.User,
          as: 'sponsor', 
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: req.tenantDb.VisaType,
          as: 'visaType',
          attributes: ['id', 'name']
        },
        {
          model: req.tenantDb.PetitionType,
          as: 'petitionType',
          attributes: ['id', 'name']
        }
      ]
    });

    res.status(200).json({
      status: "success",
      message: "Cases retrieved successfully",
      data: {
        cases,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get Cases with Filters Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get All Cases with Statistics
export const getAllCases = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status, priority, visaType, visaTypeId } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = {};

    if (search) {
      whereClause[Op.or] = [
        { caseId: { [Op.iLike]: `%${search}%` } },
        { '$candidate.first_name$': { [Op.iLike]: `%${search}%` } },
        { '$candidate.last_name$': { [Op.iLike]: `%${search}%` } }
      ];
    }

    if (status) whereClause.status = status;
    if (priority) whereClause.priority = priority;
    const visaFilter = visaTypeId || visaType;
    if (visaFilter) {
      const parsed = parseInt(visaFilter, 10);
      if (!Number.isNaN(parsed)) whereClause.visaTypeId = parsed;
    }

    const scopedWhere = mergeCaseWhere(req, whereClause);

    const { count, rows: cases } = await req.tenantDb.Case.findAndCountAll({
      where: scopedWhere,
      order: [["created_at", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset),
      include: [
        {
          model: req.tenantDb.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: req.tenantDb.User,
          as: 'sponsor', 
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: req.tenantDb.VisaType,
          as: 'visaType',
          attributes: ['id', 'name']
        },
        {
          model: req.tenantDb.PetitionType,
          as: 'petitionType',
          attributes: ['id', 'name']
        }
      ]
    });

    const statsWhere = mergeCaseWhere(req, {});
    const totalCount = await req.tenantDb.Case.count({ where: statsWhere });
    const pendingCount = await req.tenantDb.Case.count({
      where: mergeCaseWhere(req, { status: 'Pending' }),
    });
    const approvedCount = await req.tenantDb.Case.count({
      where: mergeCaseWhere(req, { status: 'Completed' }),
    });
    const rejectedCount = await req.tenantDb.Case.count({
      where: mergeCaseWhere(req, { status: 'Cancelled' }),
    });

    res.status(200).json({
      status: "success",
      message: "Cases retrieved successfully",
      data: {
        cases,
        statistics: {
          total: totalCount,
          pending: pendingCount,
          approved: approvedCount,
          rejected: rejectedCount,
        },
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get All Cases Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};


// Get Case By ID
export const getCaseById = async (req, res) => {
  try {
    const { id } = req.params;

    const caseData = (await req.tenantDb.Case.findOne({ 
      where: { caseId: id },
      include: [
        {
          model: req.tenantDb.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: req.tenantDb.User,
          as: 'sponsor', 
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: req.tenantDb.VisaType,
          as: 'visaType',
          attributes: ['id', 'name']
        },
        {
          model: req.tenantDb.PetitionType,
          as: 'petitionType',
          attributes: ['id', 'name']
        }
      ]
    })) || (!isNaN(parseInt(id)) ? await req.tenantDb.Case.findOne({
      where: { id: parseInt(id, 10) },
      include: [
        {
          model: req.tenantDb.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: req.tenantDb.User,
          as: 'sponsor', 
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: req.tenantDb.VisaType,
          as: 'visaType',
          attributes: ['id', 'name']
        },
        {
          model: req.tenantDb.PetitionType,
          as: 'petitionType',
          attributes: ['id', 'name']
        }
      ]
    }) : null);

    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    res.status(200).json({
      status: "success",
      message: "Case retrieved successfully",
      data: { case: caseData },
    });
  } catch (error) {
    console.error("Get Case by ID Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Update Case
export const updateCase = async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update Case - Request received for ID:", id);
    
    const caseData = (await req.tenantDb.Case.findOne({ where: { caseId: id } })) || 
                     (!isNaN(parseInt(id)) ? await req.tenantDb.Case.findOne({ where: { id: parseInt(id, 10) } }) : null);
    console.log("Update Case - Found case:", caseData?.caseId);

    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    const {
      candidateId,
      sponsorId,
      businessId,
      visaTypeId,
      petitionTypeId,
      priority,
      status,
      caseStage,
      targetSubmissionDate,
      lcaNumber,
      receiptNumber,
      assignedcaseworkerId,
      salaryOffered,
      totalAmount,
      paidAmount,
      notes,
      nationality,
      jobTitle,
      departmentId,
    } = req.body;

    const cwIds = Array.isArray(assignedcaseworkerId) ? assignedcaseworkerId : (assignedcaseworkerId ? [assignedcaseworkerId] : []);
    const oldCwIds = caseData.assignedcaseworkerId || [];

    const oldStatus = caseData.status;
    console.log("Update Case - Old status:", oldStatus, "New status:", status);

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

    const reqDeptId = departmentId !== undefined ? departmentId : req.body.department;
    const parsedDeptId = reqDeptId !== undefined ? (reqDeptId !== null && reqDeptId !== '' ? parseInt(reqDeptId, 10) : null) : undefined;

    const updateData = {
      candidateId: candidateId !== undefined ? candidateId : caseData.candidateId,
      sponsorId: sponsorId !== undefined ? sponsorId : caseData.sponsorId,
      businessId: businessId !== undefined ? businessId : caseData.businessId,
      visaTypeId: visaTypeId !== undefined ? visaTypeId : caseData.visaTypeId,
      petitionTypeId: petitionTypeId !== undefined ? petitionTypeId : caseData.petitionTypeId,
      priority: priority || caseData.priority,
      status: (status && (nextStage === undefined || nextStage === previousStage)) ? status : caseData.status,
      caseStage: (caseStage && (nextStage === undefined || nextStage === previousStage)) ? caseStage : caseData.caseStage,
      targetSubmissionDate: targetSubmissionDate || caseData.targetSubmissionDate,
      lcaNumber: lcaNumber !== undefined ? lcaNumber : caseData.lcaNumber,
      receiptNumber: receiptNumber !== undefined ? receiptNumber : caseData.receiptNumber,
      nationality: nationality !== undefined ? nationality : caseData.nationality,
      jobTitle: jobTitle !== undefined ? jobTitle : caseData.jobTitle,
      departmentId: parsedDeptId !== undefined ? parsedDeptId : caseData.departmentId,
      assignedcaseworkerId: cwIds.length > 0 ? cwIds : caseData.assignedcaseworkerId,
      salaryOffered: salaryOffered !== undefined ? salaryOffered : caseData.salaryOffered,
      totalAmount: totalAmount !== undefined ? totalAmount : caseData.totalAmount,
      paidAmount: paidAmount !== undefined ? paidAmount : caseData.paidAmount,
      notes: notes !== undefined ? notes : caseData.notes,
    };
    console.log("Update Case - Update data:", updateData);

    await caseData.update(updateData);
    console.log("Update Case - Update successful");

    if (nextStage !== undefined && nextStage !== previousStage) {
      if (nextStage === "biometrics_booked" && !caseData.biometricsDate) {
        await caseData.update({ biometricsDate: new Date() });
      }
      await applyCaseStageChange({
        tenantDb: req.tenantDb,
        caseRecord: caseData,
        nextStageId: nextStage,
        performedBy: req.user?.userId,
        reason: `Workflow moved to: ${getStepById(nextStage)?.title || nextStage}`,
        sendEmail: true,
        organisationId: req.user?.organisation_id ?? null,
      });
    }

    await caseData.reload();

    // Record Timeline Entry for status change
    if (status && status !== oldStatus) {
      await recordStatusChange({
        caseId: caseData.id,
        performedBy: req.user?.userId,
        previousStatus: oldStatus,
        newStatus: status,
      });
    }

    // Record Timeline Entry for assignment change
    if (JSON.stringify(oldCwIds) !== JSON.stringify(cwIds)) {
      await recordAssignmentChange({
        caseId: caseData.id,
        performedBy: req.user?.userId,
        previousAssignees: oldCwIds,
        newAssignees: cwIds,
      });
    }

    // Send status change notification if status changed
    if (status && status !== oldStatus) {
      try {
        const candidate = await req.tenantDb.User.findByPk(caseData.candidateId);
        const sponsor = await req.tenantDb.User.findByPk(caseData.sponsorId);
        const userIdsToNotify = [];
        
        // Notify candidate
        if (candidate) userIdsToNotify.push(candidate.id);
        // Notify sponsor
        if (sponsor) userIdsToNotify.push(sponsor.id);
        // Notify assigned caseworkers
        if (Array.isArray(caseData.assignedcaseworkerId)) {
          caseData.assignedcaseworkerId.forEach(id => {
            if (id) userIdsToNotify.push(id);
          });
        }

        if (userIdsToNotify.length > 0) {
          try {
            await notifyCaseStatusChanged(req.tenantDb, userIdsToNotify, {
              id: caseData.id,
              caseId: caseData.caseId,
              candidateName: candidate ? `${candidate.first_name} ${candidate.last_name}` : 'Unknown',
            }, oldStatus, status);
          } catch (notifError) {
            console.error('Failed to send status change notification:', notifError);
          }
        }
      } catch (error) {
        console.error('Error in notification process:', error);
      }
    }

    // Send Assignment Notifications if caseworkers changed
    const newCwIds = cwIds.filter(id => !oldCwIds.includes(id));
    if (newCwIds.length > 0) {
        try {
            const visaType = await req.tenantDb.VisaType.findByPk(caseData.visaTypeId);
            const candidate = await req.tenantDb.User.findByPk(caseData.candidateId);
            const caseInfo = {
                id: caseData.id,
                caseId: caseData.caseId,
                candidateName: candidate ? `${candidate.first_name} ${candidate.last_name}` : 'Unknown',
                visaType: visaType ? visaType.name : 'Not specified',
            };
            const organisationId = req.user?.organisation_id ?? null;
            for (const cwId of newCwIds) {
                await notifyCaseAssigned(req.tenantDb, cwId, caseInfo);
            }
            await createTasksOnCaseworkerAssignment({
              tenantDb: req.tenantDb,
              caseRecord: caseData,
              newCaseworkerIds: newCwIds,
              assignedBy: req.user?.userId,
              organisationId,
            }).catch((err) => console.error('createTasksOnCaseworkerAssignment:', err));
            // Also notify client that new caseworkers are assigned
            await notifyCaseStatusChanged(req.tenantDb, [caseData.candidateId, caseData.sponsorId], caseInfo, 'Previous', 'New Caseworker Assigned');
        } catch (error) {
            console.error('Error sending assignment notifications:', error);
        }
    }

    res.status(200).json({
        status: "success",
        message: "Case updated successfully",
        data: { case: caseData },
    });
  } catch (error) {
    console.error("Update Case Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Delete Case
export const deleteCase = async (req, res) => {
  try {
    const { id } = req.params;

    const caseData = (await req.tenantDb.Case.findOne({ where: { caseId: id } })) || 
                     (!isNaN(parseInt(id)) ? await req.tenantDb.Case.findOne({ where: { id: parseInt(id, 10) } }) : null);

    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    await caseData.destroy();

    res.status(200).json({
      status: "success",
      message: "Case deleted successfully",
      data: null,
    });
  } catch (error) {
    console.error("Delete Case Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

/** GET /api/cases/workflow — standard 16-step immigration process definition */
export const getCaseWorkflow = async (_req, res) => {
  try {
    res.status(200).json({
      status: "success",
      message: "Immigration case workflow retrieved",
      data: { steps: IMMIGRATION_CASE_STEPS, guidance: STAGE_GUIDANCE },
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Internal server error", error: error.message });
  }
};

// Get Pipeline Cases (grouped by immigration workflow step)
export const getPipelineCases = async (req, res) => {
  try {
    const cases = await req.tenantDb.Case.findAll({
      where: mergeCaseWhere(req, {}),
      include: [
        {
          model: req.tenantDb.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name']
        },
        {
          model: req.tenantDb.User,
          as: 'sponsor',
          attributes: ['id', 'first_name', 'last_name']
        },
        {
          model: req.tenantDb.VisaType,
          as: 'visaType',
          attributes: ['id', 'name']
        },
        {
          model: req.tenantDb.PetitionType,
          as: 'petitionType',
          attributes: ['id', 'name']
        }
      ],
      order: [["created_at", "DESC"]],
    });

    const pipeline = assignCasesToPipeline(cases);

    res.status(200).json({
      status: "success",
      message: "Pipeline cases retrieved successfully",
      data: pipeline,
      meta: { steps: IMMIGRATION_CASE_STEPS },
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Internal server error", error: error.message });
  }
};

// Update Pipeline Stage (Drag and Drop) — accepts caseStage (preferred) or legacy status
export const updatePipelineStage = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      caseStage,
      status,
      biometricLocation,
      biometricDate,
      biometricTime,
      biometricDay,
      biometricInstructions,
    } = req.body;

    let nextStage = normalizeCaseStage(caseStage);
    if (!nextStage && status) {
      nextStage = LEGACY_STATUS_TO_STAGE[status] || null;
    }
    if (!nextStage || !isValidCaseStage(nextStage)) {
      return res.status(400).json({
        status: "error",
        message: "Valid caseStage is required",
        data: null,
      });
    }

    const caseData =
      (await req.tenantDb.Case.findOne({ where: { caseId: id } })) ||
      (!Number.isNaN(parseInt(id, 10))
        ? await req.tenantDb.Case.findOne({ where: { id: parseInt(id, 10) } })
        : null);

    if (!caseData) {
      return res.status(404).json({ status: "error", message: "Case not found" });
    }

    const previousStage = resolveCaseStage(caseData);

    const gate = await assertSubmissionGate(req.tenantDb, caseData, nextStage);
    if (!gate.ok) {
      return res.status(400).json({
        status: "error",
        message: gate.message,
        data: null,
      });
    }

    if (
      nextStage === "biometrics_booked" &&
      (biometricLocation || biometricDate || biometricTime)
    ) {
      const bookResult = await bookBiometricDirect({
        tenantDb: req.tenantDb,
        caseRecord: caseData,
        location: biometricLocation,
        appointmentDate: biometricDate,
        appointmentDay: biometricDay,
        appointmentTime: biometricTime,
        instructions: biometricInstructions,
        performedBy: req.user?.userId,
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
    } else if (previousStage !== nextStage) {
      try {
        await applyCaseStageChange({
          tenantDb: req.tenantDb,
          caseRecord: caseData,
          nextStageId: nextStage,
          performedBy: req.user?.userId,
          reason: `Workflow moved to: ${getStepById(nextStage)?.title || nextStage}`,
          sendEmail: true,
          organisationId: req.user?.organisation_id ?? null,
        });
      } catch (stageErr) {
        console.error("applyCaseStageChange (pipeline):", stageErr);
      }
      await caseData.reload();
    } else if (nextStage === "biometrics_booked" && !caseData.biometricsDate) {
      await caseData.update({ biometricsDate: new Date() });
    }

    await caseData.reload();

    res.status(200).json({
      status: "success",
      message: "Pipeline stage updated",
      data: { case: caseData },
    });
  } catch (error) {
    console.error("Update Pipeline Stage Error:", error);
    res.status(500).json({ status: "error", message: "Internal server error", error: error.message });
  }
};

// Export Cases to CSV
export const exportCases = async (req, res) => {
  try {
    const { search, status, priority, visaType } = req.query;

    const whereClause = {};

    if (search) {
      whereClause[Op.or] = [
        { caseId: { [Op.iLike]: `%${search}%` } },
      ];
    }

    if (status) {
      whereClause.status = status;
    }

    if (priority) {
      whereClause.priority = priority;
    }

    if (visaType) {
      whereClause.visaTypeId = visaType;
    }

    const cases = await req.tenantDb.Case.findAll({
      where: mergeCaseWhere(req, whereClause),
      include: [
        {
          model: req.tenantDb.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: req.tenantDb.User,
          as: 'sponsor',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: req.tenantDb.VisaType,
          as: 'visaType',
          attributes: ['id', 'name']
        },
        {
          model: req.tenantDb.PetitionType,
          as: 'petitionType',
          attributes: ['id', 'name']
        }
      ],
      order: [["created_at", "DESC"]]
    });

    // Fetch caseworker names for all assigned caseworker IDs
    const allCaseworkerIds = new Set();
    cases.forEach(c => {
      const cwIds = Array.isArray(c.assignedcaseworkerId) ? c.assignedcaseworkerId : (c.assignedcaseworkerId ? [c.assignedcaseworkerId] : []);
      cwIds.forEach(id => {
        // Convert to integer if it's a numeric string, otherwise skip
        const numId = parseInt(id);
        if (!isNaN(numId)) {
          allCaseworkerIds.add(numId);
        }
      });
    });

    const caseworkers = await req.tenantDb.User.findAll({
      where: { id: Array.from(allCaseworkerIds) },
      attributes: ['id', 'first_name', 'last_name']
    });

    const caseworkerMap = {};
    caseworkers.forEach(cw => {
      caseworkerMap[cw.id] = `${cw.first_name} ${cw.last_name}`;
    });

    // Generate CSV
    const csvHeader = ['Case ID', 'Candidate', 'Candidate Email', 'Sponsor', 'Sponsor Email', 'Visa Type', 'Petition Type', 'Priority', 'Status', 'Assigned Caseworkers', 'Submission Date', 'Target Date', 'LCA Number', 'Receipt Number', 'Salary Offered', 'Total Amount', 'Paid Amount', 'Created At'];
    const csvRows = cases.map(c => {
      const cwIds = Array.isArray(c.assignedcaseworkerId) ? c.assignedcaseworkerId : (c.assignedcaseworkerId ? [c.assignedcaseworkerId] : []);
      const cwNames = cwIds.map(id => caseworkerMap[id] || `ID:${id}`).join(', ');
      
      return [
        c.caseId || 'N/A',
        c.candidate ? `${c.candidate.first_name} ${c.candidate.last_name}` : 'N/A',
        c.candidate?.email || 'N/A',
        c.sponsor ? `${c.sponsor.first_name} ${c.sponsor.last_name}` : 'N/A',
        c.sponsor?.email || 'N/A',
        c.visaType?.name || 'N/A',
        c.petitionType?.name || 'N/A',
        c.priority,
        c.status,
        cwNames || 'N/A',
        c.submissionDate || 'N/A',
        c.targetSubmissionDate || 'N/A',
        c.lcaNumber || 'N/A',
        c.receiptNumber || 'N/A',
        c.salaryOffered || 0,
        c.totalAmount || 0,
        c.paidAmount || 0,
        c.created_at || 'N/A'
      ];
    });

    const csvContent = [
      csvHeader.join(','),
      ...csvRows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="cases_export.csv"');
    res.send(csvContent);

  } catch (error) {
    console.error("Export Cases Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};
export const getTeamCapacity = async (req, res) => {
  try {
    const cases = await req.tenantDb.Case.findAll({
      attributes: ['assignedcaseworkerId'],
      where: {
        status: {
          [Op.notIn]: ['Approved', 'Rejected'] // Only active Cases
        }
      }
    });

    const userIds = new Set();
    cases.forEach(c => {
      const cwIds = Array.isArray(c.assignedcaseworkerId) ? c.assignedcaseworkerId : [];
      cwIds.forEach(id => userIds.add(id));
    });

    const users = await req.tenantDb.User.findAll({
      where: { id: Array.from(userIds) },
      attributes: ['id', 'first_name', 'last_name']
    });

    const userMap = {};
    users.forEach(u => {
      userMap[u.id] = `${u.first_name} ${u.last_name}`;
    });

    const capacityMap = {};
    cases.forEach(c => {
      const cwIds = Array.isArray(c.assignedcaseworkerId) ? c.assignedcaseworkerId : [];
      if (cwIds.length === 0) {
        const cw = 'Unassigned';
        if (!capacityMap[cw]) capacityMap[cw] = 0;
        capacityMap[cw] += 1;
      } else {
        cwIds.forEach(id => {
          const cw = userMap[id] || `Caseworker ${id}`;
          if (!capacityMap[cw]) capacityMap[cw] = 0;
          capacityMap[cw] += 1;
        });
      }
    });

    const capacityArray = Object.keys(capacityMap).map(name => ({
      name,
      val: capacityMap[name]
    }));

    res.status(200).json({
      status: "success",
      message: "Team capacity retrieved successfully",
      data: capacityArray
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Internal server error", error: error.message });
  }
};

// Assign Case
export const assignCase = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      assignTo,
      assignToName,
      caseworkerId,
      reason,
      priority,
      notes: internalNotes,
      feeAmount,
      proposedAmount,
    } = req.body;

    const caseData = (await req.tenantDb.Case.findOne({ where: { caseId: id } })) || 
                     (!isNaN(parseInt(id)) ? await req.tenantDb.Case.findOne({ where: { id: parseInt(id, 10) } }) : null);

    if (!caseData) return res.status(404).json({ status: "error", message: "Case not found" });

    const rawAssign = assignTo ?? (caseworkerId != null ? caseworkerId : null);
    const cwIds = Array.isArray(rawAssign)
      ? rawAssign
      : rawAssign != null && rawAssign !== ""
        ? [rawAssign]
        : caseData.assignedcaseworkerId;

    const noteLines = [];
    if (reason) noteLines.push(`[System]: ${reason}`);
    if (internalNotes) noteLines.push(`[Admin]: ${internalNotes}`);
    if (assignToName) noteLines.push(`[System]: Assigned to ${assignToName}`);
    const updatedNotes = noteLines.length
      ? [caseData.notes, ...noteLines].filter(Boolean).join("\n")
      : caseData.notes;

    const oldCwIds = Array.isArray(caseData.assignedcaseworkerId)
      ? caseData.assignedcaseworkerId
      : caseData.assignedcaseworkerId
        ? [caseData.assignedcaseworkerId]
        : [];
    const normalizedCwIds = Array.isArray(cwIds)
      ? cwIds.map(Number).filter((id) => Number.isFinite(id) && id > 0)
      : cwIds != null && cwIds !== ""
        ? [Number(cwIds)].filter((id) => Number.isFinite(id) && id > 0)
        : [];

    const updates = {
      assignedcaseworkerId: normalizedCwIds,
      notes: updatedNotes,
    };
    if (priority) updates.priority = priority;

    const parsedProposed = parseFloat(proposedAmount);
    if (!Number.isNaN(parsedProposed) && parsedProposed >= 0) {
      updates.proposedAmount = parsedProposed;
    }
    const hadNoCaseworker = oldCwIds.length === 0;
    const nowHasCaseworker = normalizedCwIds.length > 0;

    await caseData.update(updates);
    await caseData.reload();

    if (nowHasCaseworker && hadNoCaseworker) {
      await completePendingWorkflowTasks(req.tenantDb, {
        caseId: caseData.id,
        titlePattern: "%Review enquiry and assign caseworker%",
      }).catch((err) => console.error("complete assign enquiry tasks:", err));

      const currentStage = resolveCaseStage(caseData);
      if (currentStage === "client_enquiry") {
        try {
          await applyCaseStageChange({
            tenantDb: req.tenantDb,
            caseRecord: caseData,
            nextStageId: "admin_assignment",
            performedBy: req.user?.userId,
            reason: reason || "Caseworker assigned",
            sendEmail: true,
            organisationId: req.user?.organisation_id ?? null,
          });
          await caseData.reload();
          await syncWorkflowTasksForStage({
            tenantDb: req.tenantDb,
            caseRecord: caseData,
            stageId: "admin_assignment",
            performedBy: req.user?.userId,
            organisationId: req.user?.organisation_id ?? null,
          });
        } catch (stageErr) {
          console.error("assignCase stage advance:", stageErr);
        }
      }
    }

    // Notify assigned caseworkers
    if (normalizedCwIds.length > 0) {
      const candidate = await req.tenantDb.User.findByPk(caseData.candidateId);
      const visaType = await req.tenantDb.VisaType.findByPk(caseData.visaTypeId);
      const notifData = {
        id: caseData.id,
        caseId: caseData.caseId,
        candidateName: candidate ? `${candidate.first_name || ''} ${candidate.last_name || ''}`.trim() : 'Unknown Candidate',
        visaType: visaType ? visaType.name : 'Not specified',
        proposedAmount: caseData.proposedAmount ?? parsedProposed ?? null,
      };
      const newCwIds = normalizedCwIds.filter((id) => !oldCwIds.includes(id));
      for (const cwId of normalizedCwIds) {
        try {
          await notifyCaseAssigned(req.tenantDb, cwId, notifData);
        } catch (notifErr) {
          console.error("Failed to notify caseworker about assignment:", notifErr);
        }
      }
      if (newCwIds.length > 0) {
        await createTasksOnCaseworkerAssignment({
          tenantDb: req.tenantDb,
          caseRecord: caseData,
          newCaseworkerIds: newCwIds,
          assignedBy: req.user?.userId,
          organisationId: req.user?.organisation_id ?? null,
          assignToNames: assignToName || null,
          reason: reason || null,
        }).catch((err) => console.error('createTasksOnCaseworkerAssignment:', err));
      }
    }

    const parsedFee = parseFloat(feeAmount);
    const adminCclFee =
      !Number.isNaN(parsedProposed) && parsedProposed > 0
        ? parsedProposed
        : !Number.isNaN(parsedFee) && parsedFee > 0
          ? parsedFee
          : null;

    if (adminCclFee != null) {
      const performedBy = req.user?.userId;
      const organisationId = req.user?.organisation_id ?? null;
      try {
        await applyAdminCclFeeOnCase({
          tenantDb: req.tenantDb,
          caseRecord: caseData,
          feeAmount: adminCclFee,
          performedBy,
          organisationId,
          reviewNotes:
            reason?.trim() ||
            internalNotes?.trim() ||
            "CCL fee set by administrator on caseworker assignment",
        });
        await caseData.reload();
      } catch (cclSetupErr) {
        console.error("applyAdminCclFeeOnCase (assignCase):", cclSetupErr);
      }
    } else if (
      !Number.isNaN(parsedProposed) &&
      parsedProposed > 0 &&
      caseData.candidateId
    ) {
      try {
        await notifyProposedAmountToCandidate(req.tenantDb, caseData.candidateId, {
          caseId: caseData.caseId,
          proposedAmount: parsedProposed,
          caseRecordId: caseData.id,
        });
      } catch (feeErr) {
        console.error("proposedAmount notify on assignCase:", feeErr);
      }
    }

    res.status(200).json({
      status: "success",
      message: "Case reassigned successfully",
      data: { case: caseData }
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Internal server error", error: error.message });
  }
};

//Cases Dropdown 
export const getCasesDropdown = async (req, res) => {
  try {
    const cases = await req.tenantDb.Case.findAll({
      where: {},
      attributes: ['id', 'caseId', 'candidateId', 'sponsorId'],
      include: [
        {
          model: req.tenantDb.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name']
        }
      ]
    });

    const casesDropdown = cases.map(c => ({
      id: c.id,
      caseId: c.caseId,
      candidateName: c.candidate ? `${c.candidate.first_name} ${c.candidate.last_name}` : null
    }));

    res.status(200).json({
      status: "success",
      message: "Cases dropdown retrieved successfully",
      data: casesDropdown
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Internal server error", error: error.message });
  }
};
