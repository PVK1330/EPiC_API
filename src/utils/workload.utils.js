/**
 * Utility functions for Team Workload Monitoring
 */

/**
 * Calculate days remaining between deadline and today
 * @param {Date|string} deadline - The deadline date
 * @returns {number} Days remaining (negative if overdue)
 */
export const calculateDaysRemaining = (deadline) => {
  if (!deadline) return null;
  
  const deadlineDate = new Date(deadline);
  const today = new Date();
  
  // Reset time to midnight for accurate day calculation
  deadlineDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  
  const timeDiff = deadlineDate - today;
  return Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
};

/**
 * Calculate risk status based on days remaining
 * @param {number} daysRemaining - Days remaining
 * @returns {string} Risk status: "Breached", "At Risk", or "On Track"
 */
export const calculateRiskStatus = (daysRemaining) => {
  if (daysRemaining === null || daysRemaining === undefined) return "Unknown";
  
  if (daysRemaining < 0) return "Breached";
  if (daysRemaining <= 15) return "At Risk";
  return "On Track";
};

/**
 * Get color code for risk status
 * @param {string} riskStatus - The risk status
 * @returns {string} Color code
 */
export const getStatusColor = (riskStatus) => {
  const colorMap = {
    "Breached": "#DC3545",    // Red
    "At Risk": "#FFC107",     // Yellow/Amber
    "On Track": "#28A745",    // Green
    "Unknown": "#6C757D",     // Gray
  };
  return colorMap[riskStatus] || colorMap["Unknown"];
};

/**
 * Calculate workload percentage based on active cases
 * @param {number} activeCases - Number of active cases
 * @param {number} maxCapacity - Maximum case capacity (default: 50)
 * @returns {number} Workload percentage (0-100)
 */
export const calculateWorkloadPercentage = (activeCases, maxCapacity = 50) => {
  if (maxCapacity <= 0) return 0;
  const percentage = (activeCases / maxCapacity) * 100;
  return Math.min(Math.round(percentage), 100);
};

/**
 * Calculate average task completion time (in days)
 * @param {Array} tasks - Array of completed tasks with timestamps
 * @returns {number} Average days to complete tasks
 */
export const calculateAvgCompletionTime = (tasks) => {
  if (!Array.isArray(tasks) || tasks.length === 0) return 0;
  
  const completedTasks = tasks.filter(
    task => task.status === 'completed' && task.created_at && task.updated_at
  );
  
  if (completedTasks.length === 0) return 0;
  
  const totalDays = completedTasks.reduce((sum, task) => {
    const createdDate = new Date(task.created_at);
    const completedDate = new Date(task.updated_at);
    const daysDiff = (completedDate - createdDate) / (1000 * 60 * 60 * 24);
    return sum + daysDiff;
  }, 0);
  
  return Math.round((totalDays / completedTasks.length) * 100) / 100; // 2 decimal places
};

/**
 * Get workload health status based on metrics
 * @param {number} workloadPercentage - Workload percentage
 * @param {number} overdueCount - Number of overdue cases
 * @returns {object} Health status with color and message
 */
export const getWorkloadHealth = (workloadPercentage, overdueCount) => {
  let status = "Healthy";
  let color = "#28A745"; // Green
  let message = "Team is operating within normal capacity";
  
  if (overdueCount > 0) {
    status = "Critical";
    color = "#DC3545"; // Red
    message = `${overdueCount} overdue case(s) require immediate attention`;
  } else if (workloadPercentage >= 80) {
    status = "High";
    color = "#FFC107"; // Yellow
    message = "Team is approaching maximum capacity";
  } else if (workloadPercentage >= 60) {
    status = "Medium";
    color = "#FFC107"; // Yellow
    message = "Team workload is moderate";
  }
  
  return { status, color, message };
};

export default {
  calculateDaysRemaining,
  calculateRiskStatus,
  getStatusColor,
  calculateWorkloadPercentage,
  calculateAvgCompletionTime,
  getWorkloadHealth,
};
