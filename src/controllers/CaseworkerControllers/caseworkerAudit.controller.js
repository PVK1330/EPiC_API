import db from "../../models/index.js";
import { Op } from "sequelize";

const AuditLog = db.AuditLog;
const User = db.User;
const Case = db.Case;

/**
 * Get audit logs for a specific case (Caseworker access)
 * Only returns logs related to the specified case
 */
export const getCaseAuditLogs = async (req, res) => {
  try {
    const { caseId } = req.params;
    const {
      page = 1,
      limit = 20,
      dateRange = "last30",
      status = "all"
    } = req.query;

    const offset = (page - 1) * limit;

    // Find case by numeric ID or string caseId (e.g., "CAS-000001")
    let caseRecord;
    if (!isNaN(parseInt(caseId))) {
      // Try numeric ID first
      caseRecord = await Case.findByPk(parseInt(caseId));
    } else {
      // Try string caseId
      caseRecord = await Case.findOne({ where: { caseId } });
    }

    if (!caseRecord) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    // Use numeric id for queries
    const numericCaseId = caseRecord.id;

    const whereClause = {};

    // Handle Date Range
    const today = new Date();
    if (dateRange !== 'all' && dateRange !== 'custom') {
      const startDate = new Date();
      if (dateRange === 'last7') startDate.setDate(today.getDate() - 7);
      else if (dateRange === 'last30') startDate.setDate(today.getDate() - 30);
      else if (dateRange === 'last90') startDate.setDate(today.getDate() - 90);
      else if (dateRange === 'last365') startDate.setDate(today.getDate() - 365);
      
      whereClause.created_at = {
        [Op.gte]: startDate
      };
    }

    // Handle Status
    if (status !== "all") {
      whereClause.status = status;
    }

    // Filter to case-related logs (logs where resource contains "case" or details contains caseId)
    whereClause[Op.or] = [
      { resource: { [Op.iLike]: '%case%' } },
      { details: { [Op.iLike]: `%${numericCaseId}%` } }
    ];

    const { count, rows: auditLogs } = await AuditLog.findAndCountAll({
      where: whereClause,
      include: [{
        model: User,
        as: 'user',
        attributes: ['id', 'first_name', 'last_name'],
        include: [{
          model: db.Role,
          as: 'role',
          attributes: ['name']
        }]
      }],
      order: [["created_at", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    // Formatting response to match frontend expectations
    const formattedLogs = auditLogs.map(log => {
      const userObj = log.user;
      let userName = "System";
      let initials = "SY";
      let roleName = "System";

      if (userObj) {
        userName = `${userObj.first_name || ''} ${userObj.last_name || ''}`.trim();
        initials = `${userObj.first_name?.[0] || ''}${userObj.last_name?.[0] || ''}`.toUpperCase();
        roleName = userObj.role?.name || "User";
      }

      let actionClass = "bg-gray-100 text-gray-800";
      if (log.action.includes('Case Created')) actionClass = "bg-blue-100 text-blue-800";
      else if (log.action.includes('Updated')) actionClass = "bg-green-100 text-green-800";
      else if (log.action.includes('Login')) {
        if (log.status === 'Failed') actionClass = "bg-red-100 text-red-800";
        else actionClass = "bg-purple-100 text-purple-800";
      }
      else if (log.action.includes('Payment')) actionClass = "bg-yellow-100 text-yellow-800";
      else if (log.action.includes('User')) actionClass = "bg-indigo-100 text-indigo-800";

      return {
        id: log.id,
        timestamp: new Date(log.created_at).toLocaleString(),
        initials,
        user: userName,
        role: roleName,
        action: log.action,
        actionClass,
        resource: log.resource || "-",
        ip: log.ip_address || "-",
        status: log.status,
        statusClass: log.status === 'Success' ? "bg-green-100 text-green-800" : (log.status === 'Failed' ? "bg-red-100 text-red-800" : "bg-yellow-100 text-yellow-800"),
        details: log.details || ""
      };
    });

    res.status(200).json({
      status: "success",
      message: "Case audit logs retrieved successfully",
      data: {
        logs: formattedLogs,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get Case Audit Logs Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};
