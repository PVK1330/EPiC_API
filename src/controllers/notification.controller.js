import db from '../models/index.js';
import {
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
  createNotification,
  createNotificationForRole,
  createNotificationForAllUsers,
  createBulkNotifications,
  processScheduledNotifications,
  deleteExpiredNotifications,
  NotificationTypes,
  NotificationPriority,
} from '../services/notification.service.js';

const Notification = db.Notification;
const User = db.User;
const Role = db.Role;
const validNotificationTypes = new Set(Object.values(NotificationTypes));
const validPriorities = new Set(Object.values(NotificationPriority));
const parseSendEmailFlag = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return true;
};
const internalServerError = (res) =>
  res.status(500).json({
    status: 'error',
    message: 'Internal server error',
    data: null,
  });

// Admin: Get all notifications in the system
export const getAllNotifications = async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required',
        data: null,
      });
    }

    const {
      page = 1,
      limit = 50,
      unreadOnly = false,
      type = null,
      priority = null,
      userId: specificUserId = null,
      roleId = null,
    } = req.query;
    const parsedPage = Math.max(1, Number.parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 50));

    if (type && !validNotificationTypes.has(type)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid notification type',
        data: null,
      });
    }

    if (priority && !validPriorities.has(priority)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid notification priority',
        data: null,
      });
    }

    const whereClause = {
      ...(unreadOnly === 'true' && { isRead: false }),
      ...(type && { type }),
      ...(priority && { priority }),
      ...(specificUserId && { userId: specificUserId }),
      ...(roleId && { roleId }),
    };

    const { count, rows: notifications } = await Notification.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'first_name', 'last_name', 'email'],
          required: false,
        },
        {
          model: Role,
          as: 'role',
          attributes: ['id', 'name'],
          required: false,
        },
      ],
      order: [['createdAt', 'DESC']],
      limit: parsedLimit,
      offset: (parsedPage - 1) * parsedLimit,
    });

    res.status(200).json({
      status: 'success',
      message: 'All notifications retrieved successfully',
      data: {
        notifications,
        pagination: {
          total: count,
          page: parsedPage,
          limit: parsedLimit,
          pages: Math.ceil(count / parsedLimit),
        },
      },
    });
  } catch (error) {
    console.error('Get all notifications error:', error);
    return internalServerError(res);
  }
};

// Get all notifications for the authenticated user
export const getNotifications = async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required',
        data: null,
      });
    }

    const {
      page = 1,
      limit = 20,
      unreadOnly = false,
      type = null,
      priority = null,
    } = req.query;
    const parsedPage = Math.max(1, Number.parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));

    if (type && !validNotificationTypes.has(type)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid notification type',
        data: null,
      });
    }

    if (priority && !validPriorities.has(priority)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid notification priority',
        data: null,
      });
    }

    const result = await getUserNotifications(userId, {
      page: parsedPage,
      limit: parsedLimit,
      unreadOnly: unreadOnly === 'true',
      type,
      priority,
    });

    res.status(200).json({
      status: 'success',
      message: 'Notifications retrieved successfully',
      data: result,
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    return internalServerError(res);
  }
};

// Get unread notification count
export const getUnreadNotificationCount = async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required',
        data: null,
      });
    }

    const count = await getUnreadCount(userId);

    res.status(200).json({
      status: 'success',
      message: 'Unread count retrieved successfully',
      data: { count },
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    return internalServerError(res);
  }
};

// Mark a notification as read
export const markNotificationAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required',
        data: null,
      });
    }

    // Verify notification belongs to user
    const notification = await Notification.findOne({
      where: { id, userId },
    });

    if (!notification) {
      return res.status(404).json({
        status: 'error',
        message: 'Notification not found',
        data: null,
      });
    }

    const updated = await markAsRead(id);

    res.status(200).json({
      status: 'success',
      message: 'Notification marked as read',
      data: { notification: updated },
    });
  } catch (error) {
    console.error('Mark as read error:', error);
    return internalServerError(res);
  }
};

// Mark all notifications as read
export const markAllNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required',
        data: null,
      });
    }

    const count = await markAllAsRead(userId);

    res.status(200).json({
      status: 'success',
      message: 'All notifications marked as read',
      data: { count },
    });
  } catch (error) {
    console.error('Mark all as read error:', error);
    return internalServerError(res);
  }
};

// Delete a notification
export const deleteNotificationById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required',
        data: null,
      });
    }

    // Verify notification belongs to user
    const notification = await Notification.findOne({
      where: { id, userId },
    });

    if (!notification) {
      return res.status(404).json({
        status: 'error',
        message: 'Notification not found',
        data: null,
      });
    }

    await deleteNotification(id);

    res.status(200).json({
      status: 'success',
      message: 'Notification deleted successfully',
      data: null,
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    return internalServerError(res);
  }
};

// Admin: Create a notification (manual notification creation)
export const createManualNotification = async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required',
        data: null,
      });
    }

    const {
      recipientUserId,
      recipientUserIds,
      recipientRoleId,
      userId: legacyUserId,
      type,
      priority,
      title,
      message,
      actionType,
      entityId,
      entityType,
      metadata,
      sendEmail,
      scheduledFor,
    } = req.body;
    const sendEmailFlag = parseSendEmailFlag(sendEmail);

    if (!title || !message) {
      return res.status(400).json({
        status: 'error',
        message: 'Title and message are required',
        data: null,
      });
    }
    const finalRecipientUserId = recipientUserId || legacyUserId;
    const hasRecipient = finalRecipientUserId || recipientRoleId || (recipientUserIds && recipientUserIds.length > 0);

    if (!hasRecipient) {
      // If none provided, we treat it as broadcast to all users
      // This matches the frontend 'all' recipientType
    }

    if (type && !validNotificationTypes.has(type)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid notification type: ${type}`,
        data: null,
      });
    }

    if (priority && !validPriorities.has(priority)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid notification priority: ${priority}`,
        data: null,
      });
    }

    let notification;
    if (recipientRoleId) {
      const notifications = await createNotificationForRole(recipientRoleId, {
        type,
        priority,
        title,
        message,
        actionType,
        entityId,
        entityType,
        metadata,
        sendEmail: sendEmailFlag,
        scheduledFor,
      });
      notification = notifications[0]; // Return first created notification
    } else if (recipientUserIds && Array.isArray(recipientUserIds) && recipientUserIds.length > 0) {
      const notifications = await createBulkNotifications(recipientUserIds, {
        type,
        priority,
        title,
        message,
        actionType,
        entityId,
        entityType,
        metadata,
        sendEmail: sendEmailFlag,
        scheduledFor,
      });
      notification = notifications[0];
    } else if (finalRecipientUserId) {
      notification = await createNotification({
        userId: finalRecipientUserId,
        type,
        priority,
        title,
        message,
        actionType,
        entityId,
        entityType,
        metadata,
        sendEmail: sendEmailFlag,
        scheduledFor,
      });
    } else {
      // Broadcast to all
      const notifications = await createNotificationForAllUsers({
        type,
        priority,
        title,
        message,
        actionType,
        entityId,
        entityType,
        metadata,
        sendEmail: sendEmailFlag,
        scheduledFor,
      });
      notification = notifications[0];
    }

    res.status(201).json({
      status: 'success',
      message: 'Notification created successfully',
      data: { notification },
    });
  } catch (error) {
    console.error('Create notification error:', error);
    return internalServerError(res);
  }
};

// Admin: Get notification statistics
export const getNotificationStats = async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required',
        data: null,
      });
    }

    const unreadCount = await getUnreadCount(userId);
    const totalCount = await Notification.count({ where: { userId } });
    const readCount = totalCount - unreadCount;

    // Count by type
    const typeStats = await Notification.findAll({
      attributes: [
        'type',
        [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
      ],
      where: { userId },
      group: ['type'],
      raw: true,
    });

    // Count by priority
    const priorityStats = await Notification.findAll({
      attributes: [
        'priority',
        [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
      ],
      where: { userId },
      group: ['priority'],
      raw: true,
    });

    res.status(200).json({
      status: 'success',
      message: 'Notification statistics retrieved successfully',
      data: {
        total: totalCount,
        unread: unreadCount,
        read: readCount,
        byType: typeStats,
        byPriority: priorityStats,
      },
    });
  } catch (error) {
    console.error('Get notification stats error:', error);
    return internalServerError(res);
  }
};

// Admin: Process scheduled notifications (cron job endpoint)
export const processScheduled = async (req, res) => {
  try {
    const count = await processScheduledNotifications();
    
    res.status(200).json({
      status: 'success',
      message: 'Scheduled notifications processed',
      data: { processed: count },
    });
  } catch (error) {
    console.error('Process scheduled notifications error:', error);
    return internalServerError(res);
  }
};

// Admin: Delete expired notifications (cron job endpoint)
export const deleteExpired = async (req, res) => {
  try {
    const count = await deleteExpiredNotifications();
    
    res.status(200).json({
      status: 'success',
      message: 'Expired notifications deleted',
      data: { deleted: count },
    });
  } catch (error) {
    console.error('Delete expired notifications error:', error);
    return internalServerError(res);
  }
};
