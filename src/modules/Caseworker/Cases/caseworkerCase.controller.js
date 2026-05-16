import { Op } from 'sequelize';
import { ROLES } from '../../../middlewares/role.middleware.js';
import { assertUsersInOrganisation } from '../../../utils/tenantScope.js';
import {
  IMMIGRATION_CASE_STEPS,
  assignCasesToPipeline,
  DEFAULT_CASE_STAGE,
} from '../../../constants/immigrationCaseProcess.js';

// Helper function to check if userId is in assignedcaseworkerId (JSONB array)
const buildCaseworkerWhereClause = (req, userId) => {
  const { sequelize } = req.tenantDb;
  return {
    [Op.or]: [
      sequelize.literal(`"assignedcaseworkerId"::jsonb @> '${JSON.stringify([userId])}'::jsonb`),
      sequelize.literal(`"assignedcaseworkerId"::jsonb ? '${userId}'`)
    ]
  };
};

// Generate unique case ID (scoped to organisation when present on request)
const generateCaseId = async (req) => {
  const prefix = "C";
  const today = new Date();
  const year = today.getFullYear().toString().slice(-2);
  const month = (today.getMonth() + 1).toString().padStart(2, "0");
  const lastCase = await req.tenantDb.Case.findOne({
    where: { caseId: { [Op.like]: `${prefix}-${year}${month}%` } },
    order: [["caseId", "DESC"]],
  });
  let sequence = 1;
  if (lastCase) {
    const lastSequence = parseInt(lastCase.caseId.slice(-4), 10);
    if (!Number.isNaN(lastSequence)) sequence = lastSequence + 1;
  }
  return `${prefix}-${year}${month}${String(sequence).padStart(4, "0")}`;
};

// Get Cases Assigned to Logged-in Caseworker with Filters
export const getMyCases = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRoleId = req.user.role_id;

    // Verify user is a caseworker
    if (userRoleId !== ROLES.CASEWORKER) {
      return res.status(403).json({
        status: "error",
        message: "Access denied. Only caseworkers can view their assigned cases.",
        data: null,
      });
    }

    const { 
      page = 1, 
      limit = 10, 
      search, 
      status, 
      priority, 
      visaTypeId,
      petitionTypeId,
      sortBy = "created_at",
      sortOrder = "DESC"
    } = req.query;
    const offset = (page - 1) * limit;

    // Build where clause - filter by assigned caseworker
    const whereClause = buildCaseworkerWhereClause(req, userId);

    // Add search filter
    if (search) {
      whereClause[Op.or] = [
        { caseId: { [Op.iLike]: `%${search}%` } },
        { '$candidate.first_name$': { [Op.iLike]: `%${search}%` } },
        { '$candidate.last_name$': { [Op.iLike]: `%${search}%` } },
        { '$sponsor.first_name$': { [Op.iLike]: `%${search}%` } },
        { '$sponsor.last_name$': { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Add status filter
    if (status) {
      const statusMap = {
        'active': ['Pending', 'In Progress', 'Under Review'],
        'due_soon': ['Pending', 'In Progress'],
        'overdue': ['Overdue'],
        'completed': ['Approved', 'Rejected', 'Closed']
      };
      
      if (statusMap[status]) {
        whereClause.status = { [Op.in]: statusMap[status] };
      } else {
        whereClause.status = status;
      }
    }

    // Add priority filter
    if (priority) {
      whereClause.priority = priority;
    }

    // Add visa type filter
    if (visaTypeId) {
      whereClause.visaTypeId = visaTypeId;
    }

    // Add petition type filter
    if (petitionTypeId) {
      whereClause.petitionTypeId = petitionTypeId;
    }

    // Determine sort order
    const order = [];
    if (sortBy === 'targetSubmissionDate') {
      order.push(['targetSubmissionDate', sortOrder]);
    } else if (sortBy === 'priority') {
      order.push(['priority', sortOrder]);
    } else {
      order.push(['created_at', sortOrder]);
    }

    const { count, rows: cases } = await req.tenantDb.Case.findAndCountAll({
      where: whereClause,
      order,
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
          attributes: ['id', 'first_name', 'last_name', 'email'],
          include: [
            {
              model: req.tenantDb.SponsorProfile,
              as: 'sponsorProfile',
              attributes: ['id', 'companyName', 'tradingName'],
              required: false
            }
          ]
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
        },
        {
          model: req.tenantDb.Department,
          as: 'department',
          attributes: ['id', 'name']
        }
      ]
    });

    // Get assigned caseworkers details for each case
    const casesWithCaseworkers = await Promise.all(
      cases.map(async (caseItem) => {
        const caseworkerIds = caseItem.assignedcaseworkerId || [];
        const caseworkers = await req.tenantDb.User.findAll({
          where: { id: caseworkerIds },
          attributes: ['id', 'first_name', 'last_name', 'email']
        });
        return {
          ...caseItem.toJSON(),
          caseworkers: caseworkers
        };
      })
    );

    // Get statistics for the caseworker's cases
    const myTotal = await req.tenantDb.Case.count({
      where: buildCaseworkerWhereClause(req, userId)
    });
    const myActive = await req.tenantDb.Case.count({
      where: { 
        ...buildCaseworkerWhereClause(req, userId),
        status: { [Op.in]: ['Pending', 'In Progress', 'Under Review'] }
      }
    });
    const myOverdue = await req.tenantDb.Case.count({
      where: { 
        ...buildCaseworkerWhereClause(req, userId),
        status: 'Overdue'
      }
    });
    const myCompleted = await req.tenantDb.Case.count({
      where: { 
        ...buildCaseworkerWhereClause(req, userId),
        status: { [Op.in]: ['Approved', 'Rejected', 'Closed'] }
      }
    });

    res.status(200).json({
      status: "success",
      message: "Assigned cases retrieved successfully",
      data: {
        cases: casesWithCaseworkers,
        statistics: {
          total: myTotal,
          active: myActive,
          overdue: myOverdue,
          completed: myCompleted,
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
    console.error("Get My Cases Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get Dashboard Statistics for Logged-in Caseworker
export const getMyDashboardStats = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRoleId = req.user.role_id;

    // Verify user is a caseworker
    if (userRoleId !== ROLES.CASEWORKER) {
      return res.status(403).json({
        status: "error",
        message: "Access denied. Only caseworkers can view their dashboard stats.",
        data: null,
      });
    }

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    // Get all assigned licence applications
    const licenceWhere = {
        assignedcaseworkerId: {
            [Op.contains]: [userId]
        }
    };
    const myLicences = await req.tenantDb.LicenceApplication.count({ where: licenceWhere });
    const myPendingLicences = await req.tenantDb.LicenceApplication.count({ 
        where: { ...licenceWhere, status: { [Op.in]: ['Pending', 'Under Review', 'Information Requested'] } } 
    });

    // Get all assigned cases
    const myTotal = await req.tenantDb.Case.count({
      where: buildCaseworkerWhereClause(req, userId)
    });

    // Get active cases
    const myActive = await req.tenantDb.Case.count({
      where: { 
        ...buildCaseworkerWhereClause(req, userId),
        status: { [Op.in]: ['Pending', 'In Progress', 'Under Review'] }
      }
    });

    // Get overdue cases
    const myOverdue = await req.tenantDb.Case.count({
      where: { 
        ...buildCaseworkerWhereClause(req, userId),
        status: 'Overdue'
      }
    });

    // Get due today cases
    const myDueToday = await req.tenantDb.Case.count({
      where: { 
        ...buildCaseworkerWhereClause(req, userId),
        targetSubmissionDate: todayStr
      }
    });

    // Get completed this month
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const myCompletedMonth = await req.tenantDb.Case.count({
      where: { 
        ...buildCaseworkerWhereClause(req, userId),
        status: { [Op.in]: ['Approved', 'Rejected', 'Closed'] },
        updated_at: { [Op.gte]: startOfMonth }
      }
    });

    // Get tasks due today for this caseworker
    const tasksToday = await req.tenantDb.Task.count({
      where: {
        assigned_to: userId,
        due_date: {
          [Op.gte]: startOfDay,
          [Op.lte]: endOfDay
        },
        status: { [Op.ne]: 'completed' }
      }
    });

    // Calculate performance score based on completion rate and SLA compliance
    const totalTasks = await req.tenantDb.Task.count({
      where: { assigned_to: userId }
    });
    const completedTasks = await req.tenantDb.Task.count({
      where: { 
        assigned_to: userId,
        status: 'completed'
      }
    });
    const taskCompletionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    // Calculate SLA compliance (cases completed on time)
    const completedOnTime = await req.tenantDb.Case.count({
      where: {
        ...buildCaseworkerWhereClause(req, userId),
        status: { [Op.in]: ['Approved', 'Rejected', 'Closed'] },
        [Op.or]: [
          { targetSubmissionDate: null },
          { decisionDate: { [Op.lte]: req.tenantDb.sequelize.col('targetSubmissionDate') } }
        ]
      }
    });
    const totalCompleted = await req.tenantDb.Case.count({
      where: {
        ...buildCaseworkerWhereClause(req, userId),
        status: { [Op.in]: ['Approved', 'Rejected', 'Closed'] }
      }
    });
    const slaCompliance = totalCompleted > 0 ? (completedOnTime / totalCompleted) * 100 : 0;

    // Performance score: weighted average of task completion (40%) and SLA compliance (60%)
    const performanceScore = Math.round((taskCompletionRate * 0.4) + (slaCompliance * 0.6));

    // Get recent cases (last 5)
    const recentCases = await req.tenantDb.Case.findAll({
      where: buildCaseworkerWhereClause(req, userId),
      order: [['created_at', 'DESC']],
      limit: 5,
      include: [
        {
          model: req.tenantDb.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name']
        },
        {
          model: req.tenantDb.User,
          as: 'sponsor',
          attributes: ['id', 'first_name', 'last_name'],
          include: [
            {
              model: req.tenantDb.SponsorProfile,
              as: 'sponsorProfile',
              attributes: ['companyName', 'tradingName'],
              required: false
            }
          ]
        },
        {
          model: req.tenantDb.VisaType,
          as: 'visaType',
          attributes: ['id', 'name']
        }
      ]
    });

    // Get tasks due today with details
    const tasksTodayDetails = await req.tenantDb.Task.findAll({
      where: {
        assigned_to: userId,
        due_date: {
          [Op.gte]: startOfDay,
          [Op.lte]: endOfDay
        },
        status: { [Op.ne]: 'completed' }
      },
      include: [
        {
          model: req.tenantDb.Case,
          as: 'case',
          attributes: ['id', 'caseId'],
          include: [
            {
              model: req.tenantDb.User,
              as: 'candidate',
              attributes: ['first_name', 'last_name']
            }
          ]
        }
      ],
      order: [['due_date', 'ASC']],
      limit: 5
    });

    res.status(200).json({
      status: "success",
      message: "Dashboard statistics retrieved successfully",
      data: {
        stats: {
          assigned: myTotal,
          active: myActive,
          overdue: myOverdue,
          tasksToday: tasksToday,
          completedMonth: myCompletedMonth,
          performanceScore: performanceScore,
          licences: myLicences,
          pendingLicences: myPendingLicences
        },
        recentCases,
        tasksToday: tasksTodayDetails,
      },
    });
  } catch (error) {
    console.error("Get My Dashboard Stats Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get Pipeline Cases for Logged-in Caseworker
export const getMyPipelineCases = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRoleId = req.user.role_id;

    // Verify user is a caseworker
    if (userRoleId !== ROLES.CASEWORKER) {
      return res.status(403).json({
        status: "error",
        message: "Access denied. Only caseworkers can view their pipeline.",
        data: null,
      });
    }

    const cases = await req.tenantDb.Case.findAll({
      where: buildCaseworkerWhereClause(req, userId),
      order: [['created_at', 'DESC']],
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
          attributes: ['id', 'name'],
        },
      ],
    });

    const pipeline = assignCasesToPipeline(cases);

    res.status(200).json({
      status: "success",
      message: "Pipeline cases retrieved successfully",
      data: pipeline,
      meta: { steps: IMMIGRATION_CASE_STEPS },
    });
  } catch (error) {
    console.error("Get My Pipeline Cases Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Update Case Status (Caseworker can update their assigned cases)
export const updateMyCaseStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const userRoleId = req.user.role_id;

    // Verify user is a caseworker
    if (userRoleId !== ROLES.CASEWORKER) {
      return res.status(403).json({
        status: "error",
        message: "Access denied. Only caseworkers can update case status.",
        data: null,
      });
    }

    const { status, notes } = req.body;

    const caseData = await req.tenantDb.Case.findOne({ 
      where: { 
        caseId: id,
        ...buildCaseworkerWhereClause(req, userId)
      }
    }) || await req.tenantDb.Case.findOne({ 
      where: { 
        id: id,
        ...buildCaseworkerWhereClause(req, userId)
      }
    });

    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found or not assigned to you",
        data: null,
      });
    }

    const updateData = { status: status || caseData.status };
    if (notes) {
      updateData.notes = caseData.notes 
        ? `${caseData.notes}\n[Caseworker Update]: ${notes}` 
        : `[Caseworker Update]: ${notes}`;
    }

    await caseData.update(updateData);

    res.status(200).json({
      status: "success",
      message: "Case status updated successfully",
      data: { case: caseData },
    });
  } catch (error) {
    console.error("Update My Case Status Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Create Case (Caseworker can create new cases)
export const createMyCase = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRoleId = req.user.role_id;

    // Verify user is a caseworker
    if (userRoleId !== ROLES.CASEWORKER) {
      return res.status(403).json({
        status: "error",
        message: "Access denied. Only caseworkers can create cases.",
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
      targetSubmissionDate,
      lcaNumber,
      receiptNumber,
      nationality,
      jobTitle,
      departmentId,
      assignedcaseworkerId,
      salaryOffered,
      totalAmount,
      paidAmount,
      notes,
    } = req.body;

    // Validate required fields
    if (!candidateId || !sponsorId || !visaTypeId) {
      return res.status(400).json({
        status: "error",
        message: "Candidate, Sponsor, and Visa Type are required",
        data: null,
      });
    }

    // Fetch candidate and sponsor for notification
    const candidate = await req.tenantDb.User.findByPk(candidateId);
    const sponsor = await req.tenantDb.User.findByPk(sponsorId);

    if (!candidate) {
      return res.status(404).json({
        status: "error",
        message: "Candidate not found",
        data: null,
      });
    }

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

    // Generate case ID
    const caseId = await generateCaseId(req);

    // Handle caseworker assignment - include the creating caseworker if not specified
    const cwIds = Array.isArray(assignedcaseworkerId) ? assignedcaseworkerId : (assignedcaseworkerId ? [assignedcaseworkerId] : []);
    if (!cwIds.includes(userId)) {
      cwIds.push(userId);
    }

    const newCase = await req.tenantDb.Case.create({
      caseId,
      organisation_id: organisationId,
      candidateId,
      sponsorId,
      businessId,
      visaTypeId,
      petitionTypeId,
      priority: priority || "medium",
      status: "Lead",
      caseStage: DEFAULT_CASE_STAGE,
      submitted: new Date(),
      targetSubmissionDate,
      lcaNumber,
      receiptNumber,
      nationality,
      jobTitle,
      departmentId,
      assignedcaseworkerId: cwIds,
      salaryOffered: salaryOffered || 0,
      totalAmount: totalAmount || 0,
      paidAmount: paidAmount || 0,
      notes,
    });

    res.status(201).json({
      status: "success",
      message: "Case created successfully",
      data: { case: newCase },
    });
  } catch (error) {
    console.error("Create My Case Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Update Case (Caseworker can update their assigned cases)
export const updateMyCase = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const userRoleId = req.user.role_id;

    // Verify user is a caseworker
    if (userRoleId !== ROLES.CASEWORKER) {
      return res.status(403).json({
        status: "error",
        message: "Access denied. Only caseworkers can update cases.",
        data: null,
      });
    }

    const caseData = await req.tenantDb.Case.findOne({ 
      where: { 
        caseId: id,
        ...buildCaseworkerWhereClause(req, userId)
      }
    }) || await req.tenantDb.Case.findOne({ 
      where: { 
        id: id,
        ...buildCaseworkerWhereClause(req, userId)
      }
    });

    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found or not assigned to you",
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

    const updateData = {
      candidateId: candidateId !== undefined ? candidateId : caseData.candidateId,
      sponsorId: sponsorId !== undefined ? sponsorId : caseData.sponsorId,
      businessId: businessId !== undefined ? businessId : caseData.businessId,
      visaTypeId: visaTypeId !== undefined ? visaTypeId : caseData.visaTypeId,
      petitionTypeId: petitionTypeId !== undefined ? petitionTypeId : caseData.petitionTypeId,
      priority: priority || caseData.priority,
      status: status || caseData.status,
      targetSubmissionDate: targetSubmissionDate || caseData.targetSubmissionDate,
      lcaNumber: lcaNumber !== undefined ? lcaNumber : caseData.lcaNumber,
      receiptNumber: receiptNumber !== undefined ? receiptNumber : caseData.receiptNumber,
      nationality: nationality !== undefined ? nationality : caseData.nationality,
      jobTitle: jobTitle !== undefined ? jobTitle : caseData.jobTitle,
      departmentId: departmentId !== undefined ? departmentId : caseData.departmentId,
      assignedcaseworkerId: cwIds.length > 0 ? cwIds : caseData.assignedcaseworkerId,
      salaryOffered: salaryOffered !== undefined ? salaryOffered : caseData.salaryOffered,
      totalAmount: totalAmount !== undefined ? totalAmount : caseData.totalAmount,
      paidAmount: paidAmount !== undefined ? paidAmount : caseData.paidAmount,
      notes: notes !== undefined ? notes : caseData.notes,
    };

    await caseData.update(updateData);

    res.status(200).json({
      status: "success",
      message: "Case updated successfully",
      data: { case: caseData },
    });
  } catch (error) {
    console.error("Update My Case Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Delete Case (Caseworker can delete their assigned cases)
export const deleteMyCase = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const userRoleId = req.user.role_id;

    // Verify user is a caseworker
    if (userRoleId !== ROLES.CASEWORKER) {
      return res.status(403).json({
        status: "error",
        message: "Access denied. Only caseworkers can delete cases.",
        data: null,
      });
    }

    const caseData = await req.tenantDb.Case.findOne({
      where: {
        caseId: id,
        ...buildCaseworkerWhereClause(req, userId)
      }
    }) || await req.tenantDb.Case.findOne({
      where: {
        id: id,
        ...buildCaseworkerWhereClause(req, userId)
      }
    });

    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found or not assigned to you",
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
    console.error("Delete My Case Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get comprehensive case details for single case page
export const getCaseDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "Case ID is required",
        data: null,
      });
    }

    // Support both numeric PK (id) and human-readable case reference (caseId e.g. CAS-000001)
    const whereClause = isNaN(id) ? { caseId: id } : { id: parseInt(id) };

    // Get main case details with all relationships (only if assigned to caseworker)
    const caseData = await req.tenantDb.Case.findOne({
      where: {
        ...whereClause,
        ...buildCaseworkerWhereClause(req, userId)
      },
      include: [
        {
          model: req.tenantDb.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email', 'mobile'],
          required: false
        },
        {
          model: req.tenantDb.User,
          as: 'sponsor',
          attributes: ['id', 'first_name', 'last_name', 'email', 'mobile'],
          required: false
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
          model: req.tenantDb.Department,
          as: 'department',
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
          model: CaseCommunication,
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
        message: "Case not found or you don't have access to this case",
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
        petitionType: caseData.petitionType,
        department: caseData.department,

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
          jobTitle: caseData.jobTitle,
          departmentId: caseData.departmentId,
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

// Export Cases to CSV (Caseworker can export their assigned cases)
export const exportMyCases = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRoleId = req.user.role_id;

    // Verify user is a caseworker
    if (userRoleId !== ROLES.CASEWORKER) {
      return res.status(403).json({
        status: "error",
        message: "Access denied. Only caseworkers can export their assigned cases.",
        data: null,
      });
    }

    const { search, status, priority, visaTypeId } = req.query;

    // Build where clause - filter by assigned caseworker
    const whereClause = buildCaseworkerWhereClause(req, userId);

    // Add search filter
    if (search) {
      whereClause[Op.or] = [
        { caseId: { [Op.iLike]: `%${search}%` } },
        { '$candidate.first_name$': { [Op.iLike]: `%${search}%` } },
        { '$candidate.last_name$': { [Op.iLike]: `%${search}%` } },
        { '$sponsor.first_name$': { [Op.iLike]: `%${search}%` } },
        { '$sponsor.last_name$': { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Add status filter
    if (status) {
      const statusMap = {
        'active': ['Pending', 'In Progress', 'Under Review'],
        'due_soon': ['Pending', 'In Progress'],
        'overdue': ['Overdue'],
        'completed': ['Approved', 'Rejected', 'Closed']
      };
      
      if (statusMap[status]) {
        whereClause.status = { [Op.in]: statusMap[status] };
      } else {
        whereClause.status = status;
      }
    }

    // Add priority filter
    if (priority) {
      whereClause.priority = priority;
    }

    // Add visa type filter
    if (visaTypeId) {
      whereClause.visaTypeId = visaTypeId;
    }

    const cases = await req.tenantDb.Case.findAll({
      where: whereClause,
      include: [
        {
          model: req.tenantDb.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: req.tenantDb.User,
          as: 'sponsor',
          attributes: ['id', 'first_name', 'last_name', 'email'],
          include: [
            {
              model: req.tenantDb.SponsorProfile,
              as: 'sponsorProfile',
              attributes: ['id', 'companyName', 'tradingName'],
              required: false
            }
          ]
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
      const sponsorName = c.sponsor?.sponsorProfile?.companyName || c.sponsor?.sponsorProfile?.tradingName || (c.sponsor ? `${c.sponsor.first_name} ${c.sponsor.last_name}` : 'N/A');
      
      return [
        c.caseId || 'N/A',
        c.candidate ? `${c.candidate.first_name} ${c.candidate.last_name}` : 'N/A',
        c.candidate?.email || 'N/A',
        sponsorName,
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
    console.error("Export My Cases Error:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to export cases",
      data: null,
      error: error.message,
    });
  }
};
