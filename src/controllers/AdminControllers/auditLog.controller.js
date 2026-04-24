import db from "../../models/index.js";
import { Op } from "sequelize";

const AuditLog = db.AuditLog;
const User = db.User;

// Get All Audit Logs with Filtering and Pagination
export const getAuditLogs = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 15, 
      dateRange = "last7", 
      actionType = "all", 
      user = "all", 
      status = "all" 
    } = req.query;
    
    const offset = (page - 1) * limit;

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

    // Handle Action Type
    if (actionType !== "all") {
      if (actionType === 'login') {
        whereClause.action = { [Op.iLike]: '%Login%' };
      } else if (actionType === 'user_mgmt') {
        whereClause.action = { [Op.iLike]: '%User%' };
      } else {
        whereClause.action = actionType;
      }
    }

    // Handle Status
    if (status !== "all") {
      whereClause.status = status;
    }

    // Handle User filter
    const userInclude = {
      model: User,
      as: 'user',
      attributes: ['id', 'first_name', 'last_name'],
      include: [{
        model: db.Role,
        as: 'role',
        attributes: ['name']
      }]
    };

    if (user !== "all") {
      // If user filter is a name like "John Doe", we need to split it
      const [firstName, ...lastNameParts] = user.split(' ');
      const lastName = lastNameParts.join(' ');
      
      if (firstName && lastName) {
        userInclude.where = {
          first_name: { [Op.iLike]: `%${firstName}%` },
          last_name: { [Op.iLike]: `%${lastName}%` }
        };
      } else if (firstName) {
         userInclude.where = {
          first_name: { [Op.iLike]: `%${firstName}%` }
        };
      }
    }

    const { count, rows: auditLogs } = await AuditLog.findAndCountAll({
      where: whereClause,
      include: [userInclude],
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

    // Fetch quick stats
    const totalCount = await AuditLog.count();
    const successCount = await AuditLog.count({ where: { status: 'Success' } });
    const failedCount = await AuditLog.count({ where: { status: 'Failed' } });
    
    const todayStart = new Date();
    todayStart.setHours(0,0,0,0);
    const todayCount = await AuditLog.count({
      where: {
        created_at: {
          [Op.gte]: todayStart
        }
      }
    });

    res.status(200).json({
      status: "success",
      message: "Audit logs retrieved successfully",
      data: {
        logs: formattedLogs,
        statistics: {
          total: totalCount,
          success: successCount,
          failed: failedCount,
          today: todayCount
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
    console.error("Get Audit Logs Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};
