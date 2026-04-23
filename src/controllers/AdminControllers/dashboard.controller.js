import db from "../../models/index.js";
import { Op } from "sequelize";

const User = db.User;
const Role = db.Role;
const Case = db.Case;
const CaseNote = db.CaseNote;
const Task = db.Task;
const Document = db.Document;

// Get Dashboard Statistics
export const getDashboardStats = async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
        data: null
      });
    }

    // Get user counts by role
    const totalAdmins = await User.count({ where: { role_id: 1 } });
    const totalCaseworkers = await User.count({ where: { role_id: 2 } });
    const totalCandidates = await User.count({ where: { role_id: 3 } });
    const totalSponsors = await User.count({ where: { role_id: 4 } });

    // Get case statistics
    const totalCases = await Case.count();
    const activeCases = await Case.count({ where: { status: { [Op.ne]: 'Completed' } } });
    const completedCases = await Case.count({ where: { status: 'Completed' } });
    const pendingCases = await Case.count({ where: { status: 'Pending' } });

    // Get task statistics
    const totalTasks = await Task.count();
    const completedTasks = await Task.count({ where: { status: 'completed' } });
    const pendingTasks = await Task.count({ where: { status: 'pending' } });
    const inProgressTasks = await Task.count({ where: { status: 'in-progress' } });

    // Get document statistics
    const totalDocuments = await Document.count();

    // Get recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentCases = await Case.count({
      where: { created_at: { [Op.gte]: sevenDaysAgo } }
    });

    const recentNotes = await CaseNote.count({
      where: { created_at: { [Op.gte]: sevenDaysAgo } }
    });

    const recentTasks = await Task.count({
      where: { created_at: { [Op.gte]: sevenDaysAgo } }
    });

    // Get case status breakdown
    const caseStatusBreakdown = await Case.findAll({
      attributes: [
        'status',
        [db.sequelize.fn('COUNT', '*'), 'count']
      ],
      group: ['status'],
      raw: true
    });

    // Get task priority breakdown
    const taskPriorityBreakdown = await Task.findAll({
      attributes: [
        'priority',
        [db.sequelize.fn('COUNT', '*'), 'count']
      ],
      group: ['priority'],
      raw: true
    });

    res.status(200).json({
      status: "success",
      message: "Dashboard statistics retrieved successfully",
      data: {
        userStats: {
          totalAdmins,
          totalCaseworkers,
          totalCandidates,
          totalSponsors,
          totalUsers: totalAdmins + totalCaseworkers + totalCandidates + totalSponsors
        },
        caseStats: {
          totalCases,
          activeCases,
          completedCases,
          pendingCases,
          completionRate: totalCases > 0 ? Math.round((completedCases / totalCases) * 100) : 0
        },
        taskStats: {
          totalTasks,
          completedTasks,
          pendingTasks,
          inProgressTasks,
          completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
        },
        documentStats: {
          totalDocuments
        },
        recentActivity: {
          recentCases,
          recentNotes,
          recentTasks,
          period: "Last 7 days"
        },
        breakdowns: {
          caseStatusBreakdown,
          taskPriorityBreakdown
        }
      }
    });

  } catch (error) {
    console.error("Get Dashboard Stats Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get Recent Cases
export const getRecentCases = async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
        data: null
      });
    }

    const { limit = 10, page = 1 } = req.query;
    const offset = (page - 1) * limit;

    const { count, rows: cases } = await Case.findAndCountAll({
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
      include: [
        {
          model: User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email']
        }
      ]
    });

    res.status(200).json({
      status: "success",
      message: "Recent cases retrieved successfully",
      data: {
        cases,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(count / limit),
          totalItems: count,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error("Get Recent Cases Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get Recent Tasks
export const getRecentTasks = async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
        data: null
      });
    }

    const { limit = 10, page = 1, status } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = {};
    if (status) {
      whereClause.status = status;
    }

    const { count, rows: tasks } = await Task.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
      include: [
        {
          model: User,
          as: 'assignedTo',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: Case,
          as: 'case',
          attributes: ['id', 'caseId']
        }
      ]
    });

    res.status(200).json({
      status: "success",
      message: "Recent tasks retrieved successfully",
      data: {
        tasks,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(count / limit),
          totalItems: count,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error("Get Recent Tasks Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get Recent Activities
export const getRecentActivities = async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
        data: null
      });
    }

    const { limit = 20 } = req.query;

    // Get recent case notes
    const recentNotes = await CaseNote.findAll({
      limit: Math.ceil(parseInt(limit) / 3),
      order: [["created_at", "DESC"]],
      subQuery: false,
      attributes: ['id', 'caseId', 'noteType', 'title', 'content', 'authorId', 'created_at'],
      include: [
        {
          model: User,
          as: 'author',
          attributes: ['id', 'first_name', 'last_name']
        },
        {
          model: Case,
          as: 'case',
          attributes: ['id', 'caseId'],
          required: false
        }
      ]
    });

    // Get recent tasks
    const recentTasks = await Task.findAll({
      limit: Math.ceil(parseInt(limit) / 3),
      order: [["created_at", "DESC"]],
      include: [
        {
          model: User,
          as: 'assignedTo',
          attributes: ['id', 'first_name', 'last_name']
        },
        {
          model: Case,
          as: 'case',
          attributes: ['id', 'caseId']
        }
      ]
    });

    // Get recent cases
    const recentCases = await Case.findAll({
      limit: Math.ceil(parseInt(limit) / 3),
      order: [["created_at", "DESC"]],
      include: [
        {
          model: User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name']
        }
      ]
    });

    // Combine and sort all activities by date
    const activities = [
      ...recentNotes.map(note => ({
        type: 'case_note',
        id: note.id,
        title: `Case Note: ${note.title || 'Untitled'}`,
        description: note.content?.substring(0, 100) + '...',
        createdAt: note.created_at,
        user: note.author,
        relatedCase: note.case
      })),
      ...recentTasks.map(task => ({
        type: 'task',
        id: task.id,
        title: `Task: ${task.title}`,
        description: task.description?.substring(0, 100) + '...',
        createdAt: task.created_at,
        user: task.assignedUser,
        relatedCase: task.case
      })),
      ...recentCases.map(case_ => ({
        type: 'case',
        id: case_.id,
        title: `Case: ${case_.title}`,
        description: case_.description?.substring(0, 100) + '...',
        createdAt: case_.created_at,
        user: case_.assignedUser,
        relatedCase: case_
      }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, parseInt(limit));

    res.status(200).json({
      status: "success",
      message: "Recent activities retrieved successfully",
      data: {
        activities
      }
    });

  } catch (error) {
    console.error("Get Recent Activities Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get Quick Actions Data
export const getQuickActions = async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
        data: null
      });
    }

    // Get pending tasks for current user
    const myPendingTasks = await Task.count({
      where: { 
        assignedTo: userId,
        status: { [Op.in]: ['pending', 'in-progress'] }
      }
    });

    // Get cases assigned to current user
    const myCases = await Case.count({
      where: { assignedTo: userId }
    });

    // Get overdue tasks
    const overdueTasks = await Task.count({
      where: {
        dueDate: { [Op.lt]: new Date() },
        status: { [Op.ne]: 'completed' }
      }
    });

    // Get cases needing attention (pending or overdue)
    const casesNeedingAttention = await Case.count({
      where: {
        status: { [Op.in]: ['Pending', 'On Hold'] }
      }
    });

    res.status(200).json({
      status: "success",
      message: "Quick actions data retrieved successfully",
      data: {
        myPendingTasks,
        myCases,
        overdueTasks,
        casesNeedingAttention,
        actions: [
          {
            title: "Create New Case",
            description: "Add a new case to the system",
            icon: "plus-circle",
            route: "/cases/new"
          },
          {
            title: "View My Tasks",
            description: `You have ${myPendingTasks} pending tasks`,
            icon: "check-square",
            route: "/tasks?assignedTo=me"
          },
          {
            title: "Overdue Tasks",
            description: `${overdueTasks} tasks need immediate attention`,
            icon: "alert-circle",
            route: "/tasks?status=overdue"
          },
          {
            title: "Cases Needing Attention",
            description: `${casesNeedingAttention} cases require action`,
            icon: "eye",
            route: "/cases?status=pending"
          }
        ]
      }
    });

  } catch (error) {
    console.error("Get Quick Actions Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

export default {
  getDashboardStats,
  getRecentCases,
  getRecentTasks,
  getRecentActivities,
  getQuickActions
};
