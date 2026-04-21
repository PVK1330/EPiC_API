import db from "../../models/index.js";
import { Op } from "sequelize";

const User = db.User;
const Role = db.Role;
const Case = db.Case;
const Task = db.Task;
const CaseNote = db.CaseNote;

// Export workload data as CSV
export const exportWorkloadCSV = async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
        data: null
      });
    }

    const { timeRange = '30days' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate;
    
    switch (timeRange) {
      case '7days':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30days':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90days':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get caseworker workload data
    const caseworkers = await User.findAll({
      where: { role_id: 2 },
      attributes: ['id', 'first_name', 'last_name', 'email'],
      include: [
        {
          model: Role,
          as: 'role',
          attributes: ['id', 'name']
        },
        {
          model: Task,
          as: 'assignedTasks',
          attributes: ['id', 'status', 'priority', 'due_date', 'created_at'],
          where: {
            created_at: { [Op.gte]: startDate }
          },
          required: false
        }
      ]
    });

    // Get all cases within date range
    const allCases = await Case.findAll({
      where: {
        created_at: { [Op.gte]: startDate }
      },
      attributes: ['id', 'status', 'created_at', 'updated_at', 'assignedcaseworkerId']
    });

    // Process workload data for each caseworker
    const workloadData = caseworkers.map(caseworker => {
      const cases = allCases.filter(c => {
        const assignedIds = c.assignedcaseworkerId || [];
        return Array.isArray(assignedIds) && assignedIds.includes(caseworker.id);
      });
      const tasks = caseworker.assignedTasks || [];

      const activeCases = cases.filter(c => c.status !== 'Completed' && c.status !== 'Cancelled').length;
      const completedCases = cases.filter(c => c.status === 'Completed').length;
      
      const pendingTasks = tasks.filter(t => t.status === 'pending').length;
      const inProgressTasks = tasks.filter(t => t.status === 'in-progress').length;
      const completedTasks = tasks.filter(t => t.status === 'completed').length;
      const overdueTasks = tasks.filter(t => 
        t.status !== 'completed' && 
        t.due_date && 
        new Date(t.due_date) < now
      ).length;

      const highPriorityTasks = tasks.filter(t => t.priority === 'high' && t.status !== 'completed').length;
      const mediumPriorityTasks = tasks.filter(t => t.priority === 'medium' && t.status !== 'completed').length;
      const lowPriorityTasks = tasks.filter(t => t.priority === 'low' && t.status !== 'completed').length;

      const workloadScore = (activeCases * 2) + (pendingTasks * 1) + (inProgressTasks * 1.5) + (overdueTasks * 3);

      return {
        caseworkerName: `${caseworker.first_name} ${caseworker.last_name}`,
        email: caseworker.email,
        role: caseworker.role?.name,
        totalCases: cases.length,
        activeCases,
        completedCases,
        caseCompletionRate: cases.length > 0 ? Math.round((completedCases / cases.length) * 100) : 0,
        totalTasks: tasks.length,
        pendingTasks,
        inProgressTasks,
        completedTasks,
        overdueTasks,
        taskCompletionRate: tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0,
        highPriorityTasks,
        mediumPriorityTasks,
        lowPriorityTasks,
        workloadScore: Math.round(workloadScore),
        workloadLevel: workloadScore > 20 ? 'High' : workloadScore > 10 ? 'Medium' : 'Low'
      };
    });

    // Generate CSV
    const headers = [
      'Caseworker Name',
      'Email',
      'Role',
      'Total Cases',
      'Active Cases',
      'Completed Cases',
      'Case Completion Rate (%)',
      'Total Tasks',
      'Pending Tasks',
      'In Progress Tasks',
      'Completed Tasks',
      'Overdue Tasks',
      'Task Completion Rate (%)',
      'High Priority Tasks',
      'Medium Priority Tasks',
      'Low Priority Tasks',
      'Workload Score',
      'Workload Level'
    ];

    const csvRows = [headers.join(',')];

    workloadData.forEach(row => {
      const values = [
        `"${row.caseworkerName}"`,
        `"${row.email}"`,
        `"${row.role}"`,
        row.totalCases,
        row.activeCases,
        row.completedCases,
        row.caseCompletionRate,
        row.totalTasks,
        row.pendingTasks,
        row.inProgressTasks,
        row.completedTasks,
        row.overdueTasks,
        row.taskCompletionRate,
        row.highPriorityTasks,
        row.mediumPriorityTasks,
        row.lowPriorityTasks,
        row.workloadScore,
        `"${row.workloadLevel}"`
      ];
      csvRows.push(values.join(','));
    });

    const csvContent = csvRows.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=workload_report_${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csvContent);

  } catch (error) {
    console.error("Export Workload CSV Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get Workload Overview
export const getWorkloadOverview = async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
        data: null
      });
    }

    const { timeRange = '30days' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate;
    
    switch (timeRange) {
      case '7days':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30days':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90days':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get caseworker workload data
    const caseworkers = await User.findAll({
      where: { role_id: 2 },
      attributes: ['id', 'first_name', 'last_name', 'email'],
      include: [
        {
          model: Role,
          as: 'role',
          attributes: ['id', 'name']
        },
        {
          model: Task,
          as: 'assignedTasks',
          attributes: ['id', 'status', 'priority', 'due_date', 'created_at'],
          where: {
            created_at: { [Op.gte]: startDate }
          },
          required: false
        }
      ]
    });

    // Get all cases within date range and manually assign to caseworkers
    const allCases = await Case.findAll({
      where: {
        created_at: { [Op.gte]: startDate }
      },
      attributes: ['id', 'status', 'created_at', 'updated_at', 'assignedcaseworkerId']
    });

    // Process workload data for each caseworker
    const workloadData = caseworkers.map(caseworker => {
      // Filter cases where this caseworker is assigned (using JSON array)
      const cases = allCases.filter(c => {
        const assignedIds = c.assignedcaseworkerId || [];
        return Array.isArray(assignedIds) && assignedIds.includes(caseworker.id);
      });
      const tasks = caseworker.assignedTasks || [];

      const activeCases = cases.filter(c => c.status !== 'Completed' && c.status !== 'Cancelled').length;
      const completedCases = cases.filter(c => c.status === 'Completed').length;
      
      const pendingTasks = tasks.filter(t => t.status === 'pending').length;
      const inProgressTasks = tasks.filter(t => t.status === 'in-progress').length;
      const completedTasks = tasks.filter(t => t.status === 'completed').length;
      const overdueTasks = tasks.filter(t => 
        t.status !== 'completed' && 
        t.due_date && 
        new Date(t.due_date) < now
      ).length;

      const highPriorityTasks = tasks.filter(t => t.priority === 'high' && t.status !== 'completed').length;
      const mediumPriorityTasks = tasks.filter(t => t.priority === 'medium' && t.status !== 'completed').length;
      const lowPriorityTasks = tasks.filter(t => t.priority === 'low' && t.status !== 'completed').length;

      // Calculate workload score
      const workloadScore = (activeCases * 2) + (pendingTasks * 1) + (inProgressTasks * 1.5) + (overdueTasks * 3);

      return {
        id: caseworker.id,
        name: `${caseworker.first_name} ${caseworker.last_name}`,
        email: caseworker.email,
        role: caseworker.role?.name,
        metrics: {
          totalCases: cases.length,
          activeCases,
          completedCases,
          caseCompletionRate: cases.length > 0 ? Math.round((completedCases / cases.length) * 100) : 0,
          totalTasks: tasks.length,
          pendingTasks,
          inProgressTasks,
          completedTasks,
          overdueTasks,
          taskCompletionRate: tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0,
          priorityBreakdown: {
            high: highPriorityTasks,
            medium: mediumPriorityTasks,
            low: lowPriorityTasks
          }
        },
        workloadScore: Math.round(workloadScore),
        workloadLevel: workloadScore > 20 ? 'High' : workloadScore > 10 ? 'Medium' : 'Low'
      };
    });

    // Sort by workload score (highest first)
    workloadData.sort((a, b) => b.workloadScore - a.workloadScore);

    // Calculate summary statistics
    const summary = {
      totalCaseworkers: caseworkers.length,
      highWorkload: workloadData.filter(w => w.workloadLevel === 'High').length,
      mediumWorkload: workloadData.filter(w => w.workloadLevel === 'Medium').length,
      lowWorkload: workloadData.filter(w => w.workloadLevel === 'Low').length,
      averageWorkloadScore: Math.round(workloadData.reduce((sum, w) => sum + w.workloadScore, 0) / workloadData.length),
      totalOverdueTasks: workloadData.reduce((sum, w) => sum + w.metrics.overdueTasks, 0)
    };

    res.status(200).json({
      status: "success",
      message: "Workload overview retrieved successfully",
      data: {
        workloadData,
        summary,
        timeRange,
        generatedAt: new Date()
      }
    });

  } catch (error) {
    console.error("Get Workload Overview Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get Individual Caseworker Workload
export const getCaseworkerWorkload = async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
        data: null
      });
    }

    const { caseworkerId } = req.params;
    const { timeRange = '30days' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate;
    
    switch (timeRange) {
      case '7days':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30days':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90days':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const caseworker = await User.findOne({
      where: { id: caseworkerId, role_id: 2 },
      attributes: ['id', 'first_name', 'last_name', 'email', 'created_at'],
      include: [
        {
          model: Role,
          as: 'role',
          attributes: ['id', 'name']
        },
        {
          model: Task,
          as: 'assignedTasks',
          attributes: ['id', 'status', 'priority', 'due_date', 'created_at'],
          where: {
            created_at: { [Op.gte]: startDate }
          },
          required: false
        }
      ]
    });

    // Get all cases within date range and manually filter for this caseworker
    const allCases = await Case.findAll({
      where: {
        created_at: { [Op.gte]: startDate }
      },
      include: [
        {
          model: CaseNote,
          as: 'caseNotes',
          attributes: ['id', 'content', 'created_at'],
          required: false
        }
      ]
    });

    // Filter cases where this caseworker is assigned
    const cases = allCases.filter(c => {
      const assignedIds = c.assignedcaseworkerId || [];
      return Array.isArray(assignedIds) && assignedIds.includes(parseInt(caseworkerId));
    });

    if (!caseworker) {
      return res.status(404).json({
        status: "error",
        message: "Caseworker not found",
        data: null
      });
    }

    // Process detailed workload data
    const tasks = caseworker.assignedTasks || [];

    const detailedData = {
      caseworker: {
        id: caseworker.id,
        name: `${caseworker.first_name} ${caseworker.last_name}`,
        email: caseworker.email,
        role: caseworker.role?.name,
        joinDate: caseworker.created_at
      },
      caseWorkload: {
        total: cases.length,
        active: cases.filter(c => c.status !== 'Completed' && c.status !== 'Cancelled').length,
        completed: cases.filter(c => c.status === 'Completed').length,
        pending: cases.filter(c => c.status === 'Pending').length,
        inProgress: cases.filter(c => c.status === 'In Progress').length,
        onHold: cases.filter(c => c.status === 'On Hold').length,
        completionRate: cases.length > 0 ? Math.round((cases.filter(c => c.status === 'Completed').length / cases.length) * 100) : 0
      },
      taskWorkload: {
        total: tasks.length,
        pending: tasks.filter(t => t.status === 'pending').length,
        inProgress: tasks.filter(t => t.status === 'in-progress').length,
        completed: tasks.filter(t => t.status === 'completed').length,
        overdue: tasks.filter(t => 
          t.status !== 'completed' && 
          t.due_date && 
          new Date(t.due_date) < now
        ).length,
        priorityBreakdown: {
          high: tasks.filter(t => t.priority === 'high').length,
          medium: tasks.filter(t => t.priority === 'medium').length,
          low: tasks.filter(t => t.priority === 'low').length
        }
      },
      recentActivity: {
        recentCases: cases.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5),
        recentTasks: tasks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10)
      },
      performance: {
        averageCaseCompletionTime: calculateAverageCompletionTime(cases),
        averageTaskCompletionTime: calculateAverageCompletionTime(tasks),
        productivity: calculateProductivity(cases, tasks, startDate)
      }
    };

    res.status(200).json({
      status: "success",
      message: "Caseworker workload retrieved successfully",
      data: detailedData
    });

  } catch (error) {
    console.error("Get Caseworker Workload Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get Workload Trends
export const getWorkloadTrends = async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
        data: null
      });
    }

    const { period = 'monthly', months = 6 } = req.query;

    // Calculate date range for trends
    const endDate = new Date();
    const startDate = new Date(endDate.getFullYear(), endDate.getMonth() - months, 1);

    // Get caseworkers
    const caseworkers = await User.findAll({
      where: { role_id: 2 },
      attributes: ['id', 'first_name', 'last_name'],
      include: [
        {
          model: Task,
          as: 'assignedTasks',
          attributes: ['id', 'status', 'priority', 'created_at'],
          where: {
            created_at: { [Op.gte]: startDate }
          },
          required: false
        }
      ]
    });

    // Get all cases within date range
    const allCases = await Case.findAll({
      where: {
        created_at: { [Op.gte]: startDate }
      },
      attributes: ['id', 'status', 'created_at', 'assignedcaseworkerId']
    });

    // Attach cases to caseworkers based on JSON array
    const caseworkersWithCases = caseworkers.map(cw => ({
      ...cw.toJSON(),
      assignedCases: allCases.filter(c => {
        const assignedIds = c.assignedcaseworkerId || [];
        return Array.isArray(assignedIds) && assignedIds.includes(cw.id);
      })
    }));

    // Generate trend data based on period
    let trendData = [];
    
    if (period === 'monthly') {
      trendData = generateMonthlyTrends(caseworkersWithCases, startDate, endDate);
    } else if (period === 'weekly') {
      trendData = generateWeeklyTrends(caseworkersWithCases, startDate, endDate);
    } else {
      trendData = generateDailyTrends(caseworkersWithCases, startDate, endDate);
    }

    res.status(200).json({
      status: "success",
      message: "Workload trends retrieved successfully",
      data: {
        trends: trendData,
        period,
        dateRange: {
          start: startDate,
          end: endDate
        }
      }
    });

  } catch (error) {
    console.error("Get Workload Trends Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get Workload Alerts
export const getWorkloadAlerts = async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
        data: null
      });
    }

    const now = new Date();
    
    // Get all caseworkers with their workload
    const caseworkers = await User.findAll({
      where: { role_id: 2 },
      attributes: ['id', 'first_name', 'last_name', 'email'],
      include: [
        {
          model: Task,
          as: 'assignedTasks',
          attributes: ['id', 'status', 'priority', 'due_date', 'created_at'],
          where: {
            status: { [Op.ne]: 'completed' }
          },
          required: false
        }
      ]
    });

    // Get all active cases
    const allCases = await Case.findAll({
      where: {
        status: { [Op.notIn]: ['Completed', 'Cancelled'] }
      },
      attributes: ['id', 'status', 'created_at', 'assignedcaseworkerId']
    });

    const alerts = [];

    caseworkers.forEach(caseworker => {
      // Filter cases where this caseworker is assigned (using JSON array)
      const cases = allCases.filter(c => {
        const assignedIds = c.assignedcaseworkerId || [];
        return Array.isArray(assignedIds) && assignedIds.includes(caseworker.id);
      });
      const tasks = caseworker.assignedTasks || [];

      // Check for high workload
      const activeCases = cases.length;
      const pendingTasks = tasks.length;
      const overdueTasks = tasks.filter(t => t.due_date && new Date(t.due_date) < now).length;
      const workloadScore = (activeCases * 2) + (pendingTasks * 1) + (overdueTasks * 3);

      if (workloadScore > 20) {
        alerts.push({
          type: 'high_workload',
          severity: 'high',
          caseworkerId: caseworker.id,
          caseworkerName: `${caseworker.first_name} ${caseworker.last_name}`,
          message: `High workload detected: ${activeCases} active cases, ${pendingTasks} pending tasks`,
          recommendation: 'Consider redistributing some cases or tasks',
          score: workloadScore
        });
      }

      // Check for overdue tasks
      if (overdueTasks > 0) {
        alerts.push({
          type: 'overdue_tasks',
          severity: 'medium',
          caseworkerId: caseworker.id,
          caseworkerName: `${caseworker.first_name} ${caseworker.last_name}`,
          message: `${overdueTasks} overdue tasks detected`,
          recommendation: 'Review and prioritize overdue tasks',
          count: overdueTasks
        });
      }

      // Check for high priority tasks
      const highPriorityTasks = tasks.filter(t => t.priority === 'high' && t.status !== 'completed').length;
      if (highPriorityTasks > 3) {
        alerts.push({
          type: 'high_priority_backlog',
          severity: 'medium',
          caseworkerId: caseworker.id,
          caseworkerName: `${caseworker.first_name} ${caseworker.last_name}`,
          message: `${highPriorityTasks} high priority tasks pending`,
          recommendation: 'Address high priority tasks first',
          count: highPriorityTasks
        });
      }
    });

    // Sort alerts by severity and score
    alerts.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      if (severityOrder[b.severity] !== severityOrder[b.severity]) {
        return severityOrder[b.severity] - severityOrder[a.severity];
      }
      return (b.score || 0) - (a.score || 0);
    });

    res.status(200).json({
      status: "success",
      message: "Workload alerts retrieved successfully",
      data: {
        alerts,
        summary: {
          totalAlerts: alerts.length,
          highSeverity: alerts.filter(a => a.severity === 'high').length,
          mediumSeverity: alerts.filter(a => a.severity === 'medium').length,
          lowSeverity: alerts.filter(a => a.severity === 'low').length
        }
      }
    });

  } catch (error) {
    console.error("Get Workload Alerts Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Helper functions
function calculateAverageCompletionTime(items) {
  const completedItems = items.filter(item => item.status === 'Completed' || item.status === 'completed');
  if (completedItems.length === 0) return 0;
  
  const totalTime = completedItems.reduce((sum, item) => {
    if (item.updated_at && item.created_at) {
      return sum + (new Date(item.updated_at) - new Date(item.created_at));
    }
    return sum;
  }, 0);
  
  return Math.round(totalTime / completedItems.length / (1000 * 60 * 60 * 24)); // Convert to days
}

function calculateProductivity(cases, tasks, startDate) {
  const daysSinceStart = Math.ceil((new Date() - startDate) / (1000 * 60 * 60 * 24));
  if (daysSinceStart === 0) return 0;
  
  const completedCases = cases.filter(c => c.status === 'Completed').length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  
  return Math.round(((completedCases + completedTasks) / daysSinceStart) * 10) / 10; // Average items per day
}

function generateMonthlyTrends(caseworkers, startDate, endDate) {
  const trends = [];
  const current = new Date(startDate);
  
  while (current <= endDate) {
    const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
    const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
    
    const monthData = caseworkers.map(caseworker => {
      const cases = (caseworker.assignedCases || []).filter(c => 
        new Date(c.created_at) >= monthStart && new Date(c.created_at) <= monthEnd
      );
      const tasks = (caseworker.assignedTasks || []).filter(t => 
        new Date(t.created_at) >= monthStart && new Date(t.created_at) <= monthEnd
      );
      
      return {
        caseworkerId: caseworker.id,
        caseworkerName: `${caseworker.first_name} ${caseworker.last_name}`,
        month: current.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        casesCount: cases.length,
        tasksCount: tasks.length,
        workloadScore: (cases.filter(c => c.status !== 'Completed').length * 2) + (tasks.filter(t => t.status !== 'completed').length)
      };
    });
    
    trends.push({
      month: current.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      data: monthData
    });
    
    current.setMonth(current.getMonth() + 1);
  }
  
  return trends;
}

function generateWeeklyTrends(caseworkers, startDate, endDate) {
  // Similar implementation for weekly trends
  return [];
}

function generateDailyTrends(caseworkers, startDate, endDate) {
  // Similar implementation for daily trends
  return [];
}

export default {
  exportWorkloadCSV,
  getWorkloadOverview,
  getCaseworkerWorkload,
  getWorkloadTrends,
  getWorkloadAlerts
};
