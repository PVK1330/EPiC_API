import db from "../../models/index.js";
import { Op, Sequelize } from "sequelize";
import {
  calculateDaysRemaining,
  calculateRiskStatus,
  getStatusColor,
  calculateWorkloadPercentage,
  calculateAvgCompletionTime,
  getWorkloadHealth,
} from "../../utils/workload.utils.js";

const User = db.User;
const Case = db.Case;
const Task = db.Task;
const CaseworkerProfile = db.CaseworkerProfile;

/**
 * Helper function to get full name
 */
const getFullName = (user) => {
  if (!user) return "Unknown";
  const first = user.first_name || "";
  const last = user.last_name || "";
  return `${first} ${last}`.trim() || "Unknown";
};

/**
 * GET /api/workload/team-workload
 * Return team workload metrics with caseworker information
 */
export const  getTeamWorkload = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get all caseworkers with their profiles
    const caseworkers = await User.findAll({
      where: { role_id: 2, status: "active" }, // CASEWORKER role
      include: [
        {
          model: CaseworkerProfile,
          as: "caseworkerProfile",
          attributes: [
            "id",
            "employee_id",
            "job_title",
            "department",
            "region",
          ],
        },
      ],
      attributes: ["id", "first_name", "last_name", "email"],
      raw: false,
    });

    // Calculate metrics for each caseworker
    const teamWorkload = await Promise.all(
      caseworkers.map(async (caseworker) => {
        // Count active cases (status: In Progress or Pending)
        const activeCasesCount = await Case.count({
          where: {
            assignedcaseworkerId: {
              [Op.like]: `%${caseworker.id}%`,
            },
            status: {
              [Op.in]: ["Pending", "In Progress"],
            },
          },
        });

        // Count overdue cases
        const overdueCases = await Case.findAll({
          where: {
            assignedcaseworkerId: {
              [Op.like]: `%${caseworker.id}%`,
            },
            targetSubmissionDate: {
              [Op.lt]: today,
            },
            status: {
              [Op.in]: ["Pending", "In Progress"],
            },
          },
        });

        // Count pending tasks
        const pendingTasksCount = await Task.count({
          where: {
            assigned_to: caseworker.id,
            status: { [Op.in]: ["pending", "in-progress"] },
          },
        });

        // Get completed tasks for avg completion time
        const completedTasks = await Task.findAll({
          where: {
            assigned_to: caseworker.id,
            status: "completed",
          },
          attributes: ["id", "created_at", "updated_at"],
          raw: true,
          limit: 50,
        });

        // Calculate average completion time
        const avgCompletionTime = calculateAvgCompletionTime(completedTasks);

        // Calculate workload percentage
        const workloadPercentage = calculateWorkloadPercentage(
          activeCasesCount,
          50 // Default max capacity
        );

        // Get workload health
        const health = getWorkloadHealth(workloadPercentage, overdueCases.length);

        return {
          caseworker_id: caseworker.id,
          caseworker_name: getFullName(caseworker),
          email: caseworker.email,
          job_title: caseworker.caseworkerProfile?.job_title || "N/A",
          department: caseworker.caseworkerProfile?.department || "N/A",
          region: caseworker.caseworkerProfile?.region || "N/A",
          active_cases: activeCasesCount,
          overdue: overdueCases.length,
          tasks_pending: pendingTasksCount,
          avg_completion_time_days: avgCompletionTime,
          workload_percentage: workloadPercentage,
          health_status: health.status,
          health_color: health.color,
          health_message: health.message,
        };
      })
    );

    // Calculate team statistics
    const totalActiveCases = teamWorkload.reduce(
      (sum, cw) => sum + cw.active_cases,
      0
    );
    const totalOverdue = teamWorkload.reduce((sum, cw) => sum + cw.overdue, 0);
    const totalPendingTasks = teamWorkload.reduce(
      (sum, cw) => sum + cw.tasks_pending,
      0
    );
    const avgWorkloadPercentage =
      teamWorkload.length > 0
        ? Math.round(
            teamWorkload.reduce((sum, cw) => sum + cw.workload_percentage, 0) /
              teamWorkload.length
          )
        : 0;

    return res.status(200).json({
      status: "success",
      message: "Team workload retrieved successfully",
      data: {
        team_summary: {
          total_caseworkers: teamWorkload.length,
          total_active_cases: totalActiveCases,
          total_overdue_cases: totalOverdue,
          total_pending_tasks: totalPendingTasks,
          average_workload_percentage: avgWorkloadPercentage,
          timestamp: new Date().toISOString(),
        },
        caseworkers: teamWorkload,
      },
    });
  } catch (error) {
    console.error("Error fetching team workload:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve team workload",
      data: null,
      error: error.message,
    });
  }
};

/**
 * GET /api/workload/pending-tasks
 * Return all pending and in-progress tasks
 */
export const getPendingTasks = async (req, res) => {
  try {
    const tasks = await Task.findAll({
      where: {
        status: {
          [Op.in]: ["pending", "in-progress"],
        },
      },
      include: [
        {
          model: User,
          as: "assignee",
          attributes: ["id", "first_name", "last_name", "email"],
        },
        {
          model: Case,
          attributes: ["id", "caseId"],
        },
      ],
      order: [["due_date", "ASC"]], // Sort by due date
      raw: false,
    });

    const pendingTasks = tasks.map((task) => {
      const daysRemaining = calculateDaysRemaining(task.due_date);
      const riskStatus = calculateRiskStatus(daysRemaining);

      return {
        task_id: task.id,
        title: task.title,
        case_code: task.Case?.caseId || "N/A",
        case_id: task.case_id,
        assigned_to: getFullName(task.assignee),
        assigned_to_id: task.assigned_to,
        assigned_email: task.assignee?.email || "N/A",
        due_date: task.due_date,
        days_remaining: daysRemaining,
        risk_status: riskStatus,
        status_color: getStatusColor(riskStatus),
        priority: task.priority,
        status: task.status,
        created_at: task.created_at,
      };
    });

    // Group by risk status for summary
    const summary = {
      breached: pendingTasks.filter((t) => t.risk_status === "Breached").length,
      at_risk: pendingTasks.filter((t) => t.risk_status === "At Risk").length,
      on_track: pendingTasks.filter((t) => t.risk_status === "On Track").length,
      total: pendingTasks.length,
    };

    return res.status(200).json({
      status: "success",
      message: "Pending tasks retrieved successfully",
      data: {
        summary,
        tasks: pendingTasks,
      },
    });
  } catch (error) {
    console.error("Error fetching pending tasks:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve pending tasks",
      data: null,
      error: error.message,
    });
  }
};

/**
 * GET /api/workload/deadline-monitor
 * Return deadline monitoring information for all cases
 */
export const getDeadlineMonitor = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const cases = await Case.findAll({
      where: {
        status: {
          [Op.in]: ["Pending", "In Progress"],
        },
      },
      include: [
        {
          model: User,
          as: "candidate",
          attributes: ["id", "first_name", "last_name"],
        },
      ],
      order: [["targetSubmissionDate", "ASC"]],
      raw: false,
    });

    const deadlineMonitor = cases.map((caseRecord) => {
      const daysRemaining = calculateDaysRemaining(caseRecord.targetSubmissionDate);
      const riskStatus = calculateRiskStatus(daysRemaining);

      // Try to get caseworker names from assignedcaseworkerId
      let caseworkerNames = "Unassigned";
      if (caseRecord.assignedcaseworkerId) {
        try {
          const caseworkerIds = Array.isArray(caseRecord.assignedcaseworkerId)
            ? caseRecord.assignedcaseworkerId
            : JSON.parse(caseRecord.assignedcaseworkerId);
          caseworkerNames = caseworkerIds.join(", ");
        } catch (e) {
          caseworkerNames = String(caseRecord.assignedcaseworkerId);
        }
      }

      return {
        case_id: caseRecord.id,
        case_code: caseRecord.caseId,
        candidate_name: getFullName(caseRecord.candidate),
        caseworker_id: caseworkerNames,
        deadline: caseRecord.targetSubmissionDate,
        days_remaining: daysRemaining,
        risk_status: riskStatus,
        status_color: getStatusColor(riskStatus),
        case_status: caseRecord.status,
        priority: caseRecord.priority,
        nationality: caseRecord.nationality,
        job_title: caseRecord.jobTitle,
      };
    });

    // Group by risk status
    const summary = {
      breached: deadlineMonitor.filter((c) => c.risk_status === "Breached")
        .length,
      at_risk: deadlineMonitor.filter((c) => c.risk_status === "At Risk").length,
      on_track: deadlineMonitor.filter((c) => c.risk_status === "On Track")
        .length,
      total: deadlineMonitor.length,
    };

    return res.status(200).json({
      status: "success",
      message: "Deadline monitor retrieved successfully",
      data: {
        summary,
        cases: deadlineMonitor,
      },
    });
  } catch (error) {
    console.error("Error fetching deadline monitor:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve deadline monitor",
      data: null,
      error: error.message,
    });
  }
};

/**
 * GET /api/workload/caseworker/:id/performance
 * Get individual caseworker performance metrics
 */
export const getCaseworkerPerformance = async (req, res) => {
  try {
    const { id } = req.params;

    const caseworker = await User.findByPk(id, {
      include: [
        {
          model: CaseworkerProfile,
          as: "caseworkerProfile",
        },
      ],
    });

    if (!caseworker) {
      return res.status(404).json({
        status: "error",
        message: "Caseworker not found",
        data: null,
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get case statistics
    const activeCases = await Case.count({
      where: {
        assignedcaseworkerId: {
          [Op.like]: `%${id}%`,
        },
        status: { [Op.in]: ["Pending", "In Progress"] },
      },
    });

    const completedCases = await Case.count({
      where: {
        assignedcaseworkerId: {
          [Op.like]: `%${id}%`,
        },
        status: "Completed",
      },
    });

    const overdueCases = await Case.count({
      where: {
        assignedcaseworkerId: {
          [Op.like]: `%${id}%`,
        },
        targetSubmissionDate: { [Op.lt]: today },
        status: { [Op.in]: ["Pending", "In Progress"] },
      },
    });

    // Get task statistics
    const pendingTasks = await Task.count({
      where: {
        assigned_to: id,
        status: { [Op.in]: ["pending", "in-progress"] },
      },
    });

    const completedTasks = await Task.count({
      where: {
        assigned_to: id,
        status: "completed",
      },
    });

    const completedTasksData = await Task.findAll({
      where: {
        assigned_to: id,
        status: "completed",
      },
      attributes: ["id", "created_at", "updated_at"],
      raw: true,
      limit: 50,
    });

    const avgCompletionTime = calculateAvgCompletionTime(completedTasksData);

    return res.status(200).json({
      status: "success",
      message: "Caseworker performance retrieved successfully",
      data: {
        caseworker: {
          id: caseworker.id,
          name: getFullName(caseworker),
          email: caseworker.email,
          job_title: caseworker.caseworkerProfile?.job_title,
          department: caseworker.caseworkerProfile?.department,
          region: caseworker.caseworkerProfile?.region,
        },
        cases: {
          active: activeCases,
          completed: completedCases,
          overdue: overdueCases,
          total: activeCases + completedCases,
        },
        tasks: {
          pending: pendingTasks,
          completed: completedTasks,
          avg_completion_time_days: avgCompletionTime,
        },
        performance_score: Math.round(
          ((completedCases + completedTasks) / (activeCases + completedCases + pendingTasks + completedTasks + 1)) *
            100
        ),
      },
    });
  } catch (error) {
    console.error("Error fetching caseworker performance:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve caseworker performance",
      data: null,
      error: error.message,
    });
  }
};

export default {
  getTeamWorkload,
  getPendingTasks,
  getDeadlineMonitor,
  getCaseworkerPerformance,
};
