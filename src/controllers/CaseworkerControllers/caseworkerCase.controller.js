import db from "../../models/index.js";
import { Op } from "sequelize";
import { ROLES } from "../../middlewares/role.middleware.js";

const Case = db.Case;
const sequelize = db.sequelize;

// Helper function to check if userId is in assignedcaseworkerId JSON array
const buildCaseworkerWhereClause = (userId) => {
  // Temporarily return empty where clause to debug
  console.log('buildCaseworkerWhereClause called with userId:', userId);
  return {};
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
    const whereClause = buildCaseworkerWhereClause(userId);

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

    const { count, rows: cases } = await Case.findAndCountAll({
      where: whereClause,
      order,
      limit: parseInt(limit),
      offset: parseInt(offset),
      include: [
        {
          model: db.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: db.User,
          as: 'sponsor', 
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: db.VisaType,
          as: 'visaType',
          attributes: ['id', 'name']
        },
        {
          model: db.PetitionType,
          as: 'petitionType',
          attributes: ['id', 'name']
        }
      ]
    });

    // Get statistics for the caseworker's cases
    const myTotal = await Case.count({
      where: buildCaseworkerWhereClause(userId)
    });
    const myActive = await Case.count({
      where: { 
        ...buildCaseworkerWhereClause(userId),
        status: { [Op.in]: ['Pending', 'In Progress', 'Under Review'] }
      }
    });
    const myOverdue = await Case.count({
      where: { 
        ...buildCaseworkerWhereClause(userId),
        status: 'Overdue'
      }
    });
    const myCompleted = await Case.count({
      where: { 
        ...buildCaseworkerWhereClause(userId),
        status: { [Op.in]: ['Approved', 'Rejected', 'Closed'] }
      }
    });

    res.status(200).json({
      status: "success",
      message: "Assigned cases retrieved successfully",
      data: {
        cases,
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

    // Get all assigned cases
    const myTotal = await Case.count({
      where: buildCaseworkerWhereClause(userId)
    });

    // Get active cases
    const myActive = await Case.count({
      where: { 
        ...buildCaseworkerWhereClause(userId),
        status: { [Op.in]: ['Pending', 'In Progress', 'Under Review'] }
      }
    });

    // Get overdue cases
    const myOverdue = await Case.count({
      where: { 
        ...buildCaseworkerWhereClause(userId),
        status: 'Overdue'
      }
    });

    // Get due today cases
    const myDueToday = await Case.count({
      where: { 
        ...buildCaseworkerWhereClause(userId),
        targetSubmissionDate: todayStr
      }
    });

    // Get completed this month
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const myCompletedMonth = await Case.count({
      where: { 
        ...buildCaseworkerWhereClause(userId),
        status: { [Op.in]: ['Approved', 'Rejected', 'Closed'] },
        updated_at: { [Op.gte]: startOfMonth }
      }
    });

    // Get recent cases (last 5)
    const recentCases = await Case.findAll({
      where: buildCaseworkerWhereClause(userId),
      order: [['created_at', 'DESC']],
      limit: 5,
      include: [
        {
          model: db.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name']
        },
        {
          model: db.User,
          as: 'sponsor',
          attributes: ['id', 'first_name', 'last_name']
        },
        {
          model: db.VisaType,
          as: 'visaType',
          attributes: ['id', 'name']
        }
      ]
    });

    res.status(200).json({
      status: "success",
      message: "Dashboard statistics retrieved successfully",
      data: {
        stats: {
          assigned: myTotal,
          active: myActive,
          overdue: myOverdue,
          dueToday: myDueToday,
          completedMonth: myCompletedMonth,
        },
        recentCases,
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

    const cases = await Case.findAll({
      where: buildCaseworkerWhereClause(userId),
      order: [['created_at', 'DESC']],
      include: [
        {
          model: db.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name']
        },
        {
          model: db.User,
          as: 'sponsor',
          attributes: ['id', 'first_name', 'last_name']
        }
      ]
    });

    const pipeline = {
      lead: [],
      onboarded: [],
      docs: [],
      drafting: [],
      review: [],
      submitted: [],
      decision: [],
      closed: [],
    };

    cases.forEach(c => {
      const stat = (c.status || "Lead").toLowerCase();
      if (stat === "lead" || stat === "new") pipeline.lead.push(c);
      else if (stat === "onboarded") pipeline.onboarded.push(c);
      else if (stat === "docs pending" || stat === "docs") pipeline.docs.push(c);
      else if (stat === "drafting") pipeline.drafting.push(c);
      else if (stat === "review") pipeline.review.push(c);
      else if (stat === "submitted") pipeline.submitted.push(c);
      else if (stat === "decision") pipeline.decision.push(c);
      else if (stat === "closed" || stat === "approved" || stat === "rejected") pipeline.closed.push(c);
      else pipeline.lead.push(c);
    });

    res.status(200).json({
      status: "success",
      message: "Pipeline cases retrieved successfully",
      data: pipeline
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

    const caseData = await Case.findOne({ 
      where: { 
        caseId: id,
        ...buildCaseworkerWhereClause(userId)
      } 
    }) || await Case.findOne({ 
      where: { 
        id: id,
        ...buildCaseworkerWhereClause(userId)
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
