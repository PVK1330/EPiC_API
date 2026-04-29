import db from '../models/index.js';
import transporter from '../config/mail.js';
import { generateNotificationEmailTemplate } from '../utils/emailTemplate.js';

const Notification = db.Notification;
const User = db.User;
const Role = db.Role;

const sendNotificationEmailToUser = async (userId, notification) => {
  const user = await User.findByPk(userId, {
    attributes: ['id', 'email', 'first_name', 'last_name', 'status'],
  });

  if (!user || user.status !== 'active' || !user.email) {
    return false;
  }

  const recipientName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: user.email,
    subject: `EPiC Notification: ${notification.title}`,
    html: generateNotificationEmailTemplate({
      recipientName,
      title: notification.title,
      message: notification.message,
      priority: notification.priority,
      notificationType: notification.type,
      metadata: notification.metadata || {},
    }),
  });

  return true;
};

// Notification type constants
export const NotificationTypes = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
  CASE_CREATED: 'case_created',
  CASE_UPDATED: 'case_updated',
  CASE_ASSIGNED: 'case_assigned',
  CASE_STATUS_CHANGED: 'case_status_changed',
  PAYMENT_RECEIVED: 'payment_received',
  PAYMENT_OVERDUE: 'payment_overdue',
  DOCUMENT_UPLOADED: 'document_uploaded',
  DOCUMENT_REVIEWED: 'document_reviewed',
  LICENCE_INFO_REQUESTED: 'licence_info_requested',
  MESSAGE_RECEIVED: 'message_received',
  ESCALATION_CREATED: 'escalation_created',
  ESCALATION_RESOLVED: 'escalation_resolved',
  USER_CREATED: 'user_created',
  USER_STATUS_CHANGED: 'user_status_changed',
  SYSTEM_MAINTENANCE: 'system_maintenance',
  SLA_BREACH: 'sla_breach',
  LICENCE_STATUS_CHANGED: 'licence_status_changed',
  LICENCE_ASSIGNED: 'licence_assigned',
};

// Notification priority constants
export const NotificationPriority = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent',
};

/**
 * Create a notification for a specific user
 * @param {Object} data - Notification data
 * @param {number} data.userId - User ID to send notification to
 * @param {string} data.type - Notification type
 * @param {string} data.priority - Notification priority
 * @param {string} data.title - Notification title
 * @param {string} data.message - Notification message
 * @param {string} data.actionType - Type of action that triggered notification
 * @param {number} data.entityId - ID of related entity
 * @param {string} data.entityType - Type of related entity
 * @param {Object} data.metadata - Additional metadata
 * @param {boolean} data.sendEmail - Whether to send email
 * @param {Date} data.scheduledFor - Schedule for later
 * @returns {Promise<Object>} Created notification
 */
export const createNotification = async (data) => {
  try {
    const {
      userId,
      roleId,
      type = NotificationTypes.INFO,
      priority = NotificationPriority.MEDIUM,
      title,
      message,
      actionType,
      entityId,
      entityType,
      metadata = {},
      sendEmail = false,
      scheduledFor,
      expiresAt,
    } = data;

    if (!userId) {
      throw new Error('userId is required');
    }

    if (!title || !message) {
      throw new Error('Title and message are required');
    }

    const notificationData = {
      userId,
      roleId,
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
      expiresAt,
      sentAt: scheduledFor ? null : new Date(),
    };

    const notification = await Notification.create(notificationData);

    // If email sending is enabled, send email immediately for non-scheduled notifications.
    if (sendEmail && !scheduledFor) {
      (async () => {
        try {
          const sent = await sendNotificationEmailToUser(userId, notification);
          if (sent) {
            await notification.update({ emailSent: true });
          }
        } catch (emailError) {
          console.error(`Email send failed for notification ${notification.id}:`, emailError);
        }
      })();
    }

    // BROADCAST TO ADMINS: If this is NOT already an admin notification, notify admins too.
    if (!data.isInternalAdminOnly && !scheduledFor) {
      (async () => {
        try {
          const adminRole = await db.Role.findOne({ where: { name: 'admin' } });
          if (adminRole) {
            // Find all admin users EXCEPT the one who might already be the recipient
            const admins = await db.User.findAll({
              where: {
                role_id: adminRole.id,
                id: { [db.Sequelize.Op.ne]: userId },
                status: 'active'
              },
              attributes: ['id']
            });

            for (const admin of admins) {
              await Notification.create({
                ...notificationData,
                userId: admin.id,
                emailSent: false, // Don't spam admin emails for every single user notification
                sendEmail: false, // Internal feed only by default
                sentAt: new Date(),
              });
            }
          }
        } catch (err) {
          console.error('Error sending copy to admins:', err);
        }
      })();
    }

    await notification.reload();
    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
};

export const notifyAdmins = async (notificationData) => {
  try {
    const adminRole = await db.Role.findOne({ where: { name: 'Admin' } });
    if (!adminRole) return;

    const admins = await db.User.findAll({
      where: { role_id: adminRole.id, status: 'active' },
      attributes: ['id']
    });

    for (const admin of admins) {
      await createNotification({
        ...notificationData,
        userId: admin.id,
      });
    }
  } catch (err) {
    console.error('Error notifying admins:', err);
  }
};

/**
 * Create notification for multiple users (bulk)
 * @param {Array<number>} userIds - Array of user IDs
 * @param {Object} notificationData - Notification data (same as createNotification)
 * @returns {Promise<Array>} Created notifications
 */
export const createBulkNotifications = async (userIds, notificationData) => {
  try {
    const notifications = await Promise.all(
      userIds.map((userId) =>
        createNotification({
          ...notificationData,
          userId,
        })
      )
    );
    return notifications;
  } catch (error) {
    console.error('Error creating bulk notifications:', error);
    throw error;
  }
};

/**
 * Create notification for all users with a specific role
 * @param {number} roleId - Role ID
 * @param {Object} notificationData - Notification data
 * @returns {Promise<Array>} Created notifications
 */
export const createNotificationForRole = async (roleId, notificationData) => {
  try {
    const users = await User.findAll({
      where: { role_id: roleId, status: 'active' },
      attributes: ['id'],
    });

    const userIds = users.map((user) => user.id);
    if (!userIds.length) {
      throw new Error('No active users found for the selected role');
    }
    return await createBulkNotifications(userIds, notificationData);
  } catch (error) {
    console.error('Error creating role notification:', error);
    throw error;
  }
};

/**
 * Create notification for all active users
 * @param {Object} notificationData - Notification data
 * @returns {Promise<Array>} Created notifications
 */
export const createNotificationForAllUsers = async (notificationData) => {
  try {
    const users = await User.findAll({
      where: { status: 'active' },
      attributes: ['id'],
    });

    const userIds = users.map((user) => user.id);
    if (!userIds.length) {
      throw new Error('No active users found');
    }
    return await createBulkNotifications(userIds, notificationData);
  } catch (error) {
    console.error('Error creating broadcast notification:', error);
    throw error;
  }
};

/**
 * Mark notification as read
 * @param {number} notificationId - Notification ID
 * @returns {Promise<Object>} Updated notification
 */
export const markAsRead = async (notificationId) => {
  try {
    const notification = await Notification.findByPk(notificationId);
    if (!notification) {
      throw new Error('Notification not found');
    }

    await notification.update({
      isRead: true,
      readAt: new Date(),
    });

    return notification;
  } catch (error) {
    console.error('Error marking notification as read:', error);
    throw error;
  }
};

/**
 * Mark all notifications as read for a user
 * @param {number} userId - User ID
 * @returns {Promise<number>} Number of updated notifications
 */
export const markAllAsRead = async (userId) => {
  try {
    const [count] = await Notification.update(
      {
        isRead: true,
        readAt: new Date(),
      },
      {
        where: {
          userId,
          isRead: false,
        },
      }
    );
    return count;
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    throw error;
  }
};

/**
 * Delete notification
 * @param {number} notificationId - Notification ID
 * @returns {Promise<boolean>} Success status
 */
export const deleteNotification = async (notificationId) => {
  try {
    const notification = await Notification.findByPk(notificationId);
    if (!notification) {
      throw new Error('Notification not found');
    }

    await notification.destroy();
    return true;
  } catch (error) {
    console.error('Error deleting notification:', error);
    throw error;
  }
};

/**
 * Get unread count for a user
 * @param {number} userId - User ID
 * @returns {Promise<number>} Unread count
 */
export const getUnreadCount = async (userId) => {
  try {
    const count = await Notification.count({
      where: {
        userId,
        isRead: false,
      },
    });
    return count;
  } catch (error) {
    console.error('Error getting unread count:', error);
    throw error;
  }
};

/**
 * Get notifications for a user with pagination
 * @param {number} userId - User ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Notifications with pagination
 */
export const getUserNotifications = async (userId, options = {}) => {
  try {
    const {
      page = 1,
      limit = 20,
      unreadOnly = false,
      type = null,
      priority = null,
    } = options;

    const offset = (page - 1) * limit;

    const whereClause = {
      userId,
      ...(unreadOnly && { isRead: false }),
      ...(type && { type }),
      ...(priority && { priority }),
    };

    const { count, rows: notifications } = await Notification.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'first_name', 'last_name', 'email'],
        },
        {
          model: Role,
          as: 'role',
          attributes: ['id', 'name'],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    return {
      notifications,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(count / limit),
      },
    };
  } catch (error) {
    console.error('Error getting user notifications:', error);
    throw error;
  }
};

/**
 * Process scheduled notifications (to be called by a cron job)
 * @returns {Promise<number>} Number of processed notifications
 */
export const processScheduledNotifications = async () => {
  try {
    const now = new Date();
    const dueNotifications = await Notification.findAll({
      where: {
        scheduledFor: {
          [db.Sequelize.Op.lte]: now,
        },
        sentAt: null,
      },
      order: [['scheduledFor', 'ASC']],
    });

    if (!dueNotifications.length) {
      return 0;
    }

    for (const notification of dueNotifications) {
      let emailSent = false;
      if (notification.sendEmail) {
        try {
          emailSent = await sendNotificationEmailToUser(notification.userId, notification);
        } catch (emailError) {
          console.error(`Scheduled email send failed for notification ${notification.id}:`, emailError);
        }
      }

      await notification.update({
        sentAt: now,
        emailSent,
      });
    }

    return dueNotifications.length;
  } catch (error) {
    console.error('Error processing scheduled notifications:', error);
    throw error;
  }
};

/**
 * Delete expired notifications (to be called by a cron job)
 * @returns {Promise<number>} Number of deleted notifications
 */
export const deleteExpiredNotifications = async () => {
  try {
    const now = new Date();
    const count = await Notification.destroy({
      where: {
        expiresAt: {
          [db.Sequelize.Op.lt]: now,
        },
      },
    });
    return count;
  } catch (error) {
    console.error('Error deleting expired notifications:', error);
    throw error;
  }
};

// ==================== NOTIFICATION EVENT HELPERS ====================

/**
 * Send case assignment notification
 * @param {number} caseworkerId - Caseworker user ID
 * @param {Object} caseData - Case information
 */
export const notifyCaseAssigned = async (caseworkerId, caseData) => {
  const safeCaseId = caseData?.caseId || caseData?.id || 'Unknown';
  const safeCandidateName = caseData?.candidateName || 'a candidate';
  const safeVisaType = caseData?.visaType || 'Not specified';
  
  return await createNotification({
    userId: caseworkerId,
    type: NotificationTypes.CASE_ASSIGNED,
    priority: NotificationPriority.HIGH,
    title: `New Case Assigned: ${safeCaseId}`,
    message: `You have been assigned to case ${safeCaseId} for ${safeCandidateName}.`,
    actionType: 'case_assignment',
    entityId: caseData?.id || null,
    entityType: 'case',
    metadata: {
      caseId: safeCaseId,
      candidateName: safeCandidateName,
      visaType: safeVisaType,
    },
    sendEmail: true,
  });
};

/**
 * Send notification when a new case is created
 * @param {Object} caseData - Case information
 */
export const notifyCaseCreated = async (caseData) => {
  const safeCaseId = caseData?.caseId || 'Unknown';
  const safeCandidateName = caseData?.candidateName || 'a candidate';
  
  // Notify all Admins
  try {
    const adminRole = await db.Role.findOne({ where: { name: 'admin' } });
    if (adminRole) {
      await createNotificationForRole(adminRole.id, {
        type: NotificationTypes.CASE_CREATED,
        priority: NotificationPriority.HIGH,
        title: `New Case Created: ${safeCaseId}`,
        message: `A new case ${safeCaseId} has been created for ${safeCandidateName}.`,
        actionType: 'case_creation',
        entityId: caseData?.id || null,
        entityType: 'case',
        metadata: {
          caseId: safeCaseId,
          candidateName: safeCandidateName,
        },
        sendEmail: true,
        isInternalAdminOnly: true,
      });
    }
  } catch (err) {
    console.error('Error in notifyCaseCreated:', err);
  }
};

/**
 * Send case status change notification
 * @param {Array<number>} userIds - User IDs to notify
 * @param {Object} caseData - Case information
 * @param {string} oldStatus - Previous status
 * @param {string} newStatus - New status
 */
export const notifyCaseStatusChanged = async (userIds, caseData, oldStatus, newStatus) => {
  const safeCaseId = caseData?.caseId || caseData?.id || 'Unknown';
  const safeOldStatus = oldStatus || 'Unknown';
  const safeNewStatus = newStatus || 'Unknown';
  const safeCandidateName = caseData?.candidateName || 'Not specified';
  
  return await createBulkNotifications(userIds, {
    type: NotificationTypes.CASE_STATUS_CHANGED,
    priority: NotificationPriority.HIGH,
    title: `Case Status Updated: ${safeCaseId}`,
    message: `Case ${safeCaseId} status changed from ${safeOldStatus} to ${safeNewStatus}.`,
    actionType: 'case_status_change',
    entityId: caseData?.id || null,
    entityType: 'case',
    metadata: {
      caseId: safeCaseId,
      oldStatus: safeOldStatus,
      newStatus: safeNewStatus,
      candidateName: safeCandidateName,
    },
    sendEmail: true,
  });
};

/**
 * Send payment received notification
 * @param {number} userId - User ID (candidate or business)
 * @param {Object} paymentData - Payment information
 */
export const notifyPaymentReceived = async (userId, paymentData) => {
  const safeInvoiceId = paymentData?.invoiceId || paymentData?.id || 'Unknown';
  const safeAmount = paymentData?.amount || paymentData?.paymentAmount || '0';
  const safeCaseId = paymentData?.caseId || 'your case';
  
  return await createNotification({
    userId,
    type: NotificationTypes.PAYMENT_RECEIVED,
    priority: NotificationPriority.MEDIUM,
    title: `Payment Received: ${safeInvoiceId}`,
    message: `Payment of ${safeAmount} has been received for ${safeCaseId}.`,
    actionType: 'payment_received',
    entityId: paymentData?.id || null,
    entityType: 'payment',
    metadata: {
      amount: safeAmount,
      caseId: safeCaseId,
      invoiceId: safeInvoiceId,
    },
    sendEmail: true,
  });
};

/**
 * Send payment overdue notification
 * @param {number} userId - User ID
 * @param {Object} paymentData - Payment information
 */
export const notifyPaymentOverdue = async (userId, paymentData) => {
  const safeInvoiceId = paymentData?.invoiceId || 'Unknown';
  const safeAmount = paymentData?.amount || '0';
  const safeCaseId = paymentData?.caseId || 'your case';
  const safeDueDate = paymentData?.dueDate || 'Not specified';
  
  return await createNotification({
    userId,
    type: NotificationTypes.PAYMENT_OVERDUE,
    priority: NotificationPriority.HIGH,
    title: `Payment Overdue: ${safeInvoiceId}`,
    message: `Payment of ${safeAmount} is overdue for ${safeCaseId}. Please make payment as soon as possible.`,
    actionType: 'payment_overdue',
    entityId: paymentData?.id || null,
    entityType: 'payment',
    metadata: {
      amount: safeAmount,
      caseId: safeCaseId,
      invoiceId: safeInvoiceId,
      dueDate: safeDueDate,
    },
    sendEmail: true,
  });
};

/**
 * Send document uploaded notification
 * @param {number} userId - User ID to notify
 * @param {Object} documentData - Document information
 */
export const notifyDocumentUploaded = async (userId, documentData) => {
  const safeFileName = documentData?.fileName || 'Unknown file';
  const safeCaseId = documentData?.caseId || 'your case';
  const safeUploadedBy = documentData?.uploadedBy || 'Unknown';
  
  return await createNotification({
    userId,
    type: NotificationTypes.DOCUMENT_UPLOADED,
    priority: NotificationPriority.LOW,
    title: `Document Uploaded: ${safeFileName}`,
    message: `New document "${safeFileName}" has been uploaded for case ${safeCaseId}.`,
    actionType: 'document_upload',
    entityId: documentData?.id || null,
    entityType: 'document',
    metadata: {
      fileName: safeFileName,
      caseId: safeCaseId,
      uploadedBy: safeUploadedBy,
    },
  });
};

/**
 * Send document reviewed notification
 * @param {number} userId - User ID (document uploader)
 * @param {Object} documentData - Document information
 * @param {string} status - Review status
 */
export const notifyDocumentReviewed = async (userId, documentData, status) => {
  const safeFileName = documentData?.fileName || 'Unknown file';
  const safeCaseId = documentData?.caseId || 'your case';
  const safeStatus = status || 'Unknown';
  
  return await createNotification({
    userId,
    type: NotificationTypes.DOCUMENT_REVIEWED,
    priority: NotificationPriority.MEDIUM,
    title: `Document Reviewed: ${safeFileName}`,
    message: `Your document "${safeFileName}" has been reviewed. Status: ${safeStatus}.`,
    actionType: 'document_review',
    entityId: documentData?.id || null,
    entityType: 'document',
    metadata: {
      fileName: safeFileName,
      caseId: safeCaseId,
      status: safeStatus,
    },
    sendEmail: true,
  });
};

/**
 * Send escalation created notification
 * @param {number} adminId - Admin user ID
 * @param {Object} escalationData - Escalation information
 */
export const notifyEscalationCreated = async (adminId, escalationData) => {
  const safeTitle = escalationData?.title || escalationData?.id || 'Unknown';
  const safeCaseId = escalationData?.caseId || 'Unknown case';
  const safePriority = escalationData?.priority || 'Not specified';
  
  return await createNotification({
    userId: adminId,
    type: NotificationTypes.ESCALATION_CREATED,
    priority: NotificationPriority.URGENT,
    title: `New Escalation: ${safeTitle}`,
    message: `A new escalation has been created for case ${safeCaseId}. Priority: ${safePriority}.`,
    actionType: 'escalation_created',
    entityId: escalationData?.id || null,
    entityType: 'escalation',
    metadata: {
      caseId: safeCaseId,
      priority: safePriority,
      title: safeTitle,
    },
    sendEmail: true,
  });
};

/**
 * Send escalation resolved notification
 * @param {Array<number>} userIds - User IDs to notify
 * @param {Object} escalationData - Escalation information
 */
export const notifyEscalationResolved = async (userIds, escalationData) => {
  const safeTitle = escalationData?.title || escalationData?.id || 'Unknown';
  const safeCaseId = escalationData?.caseId || 'Unknown case';
  const safeResolution = escalationData?.resolution || 'No resolution details provided';
  
  return await createBulkNotifications(userIds, {
    type: NotificationTypes.ESCALATION_RESOLVED,
    priority: NotificationPriority.MEDIUM,
    title: `Escalation Resolved: ${safeTitle}`,
    message: `Escalation for case ${safeCaseId} has been resolved.`,
    actionType: 'escalation_resolved',
    entityId: escalationData?.id || null,
    entityType: 'escalation',
    metadata: {
      caseId: safeCaseId,
      resolution: safeResolution,
    },
    sendEmail: true,
  });
};

/**
 * Send user created notification (for admins)
 * @param {number} roleId - Role ID (e.g., admin role ID)
 * @param {Object} userData - User information
 */
export const notifyUserCreated = async (roleId, userData) => {
  const safeEmail = userData?.email || 'Unknown email';
  const safeRole = userData?.role || 'user';
  const safeFirstName = userData?.first_name || '';
  const safeLastName = userData?.last_name || '';
  const safeName = safeFirstName && safeLastName ? `${safeFirstName} ${safeLastName}` : safeEmail;
  
  return await createNotificationForRole(roleId, {
    type: NotificationTypes.USER_CREATED,
    priority: NotificationPriority.LOW,
    title: `New User Created: ${safeEmail}`,
    message: `A new ${safeRole} account has been created for ${safeEmail}.`,
    actionType: 'user_created',
    entityId: userData?.id || null,
    entityType: 'user',
    metadata: {
      email: safeEmail,
      role: safeRole,
      name: safeName,
    },
  });
};

/**
 * Send SLA breach notification
 * @param {Array<number>} userIds - User IDs to notify
 * @param {Object} caseData - Case information
 * @param {string} slaType - Type of SLA breached
 */
export const notifySLABreach = async (userIds, caseData, slaType) => {
  const safeCaseId = caseData?.caseId || caseData?.id || 'Unknown';
  const safeSlaType = slaType || 'Unknown';
  const safeCandidateName = caseData?.candidateName || 'Not specified';
  
  return await createBulkNotifications(userIds, {
    type: NotificationTypes.SLA_BREACH,
    priority: NotificationPriority.URGENT,
    title: `SLA Breach: ${safeCaseId}`,
    message: `SLA breach detected for case ${safeCaseId}. Type: ${safeSlaType}.`,
    actionType: 'sla_breach',
    entityId: caseData?.id || null,
    entityType: 'case',
    metadata: {
      caseId: safeCaseId,
      slaType: safeSlaType,
      candidateName: safeCandidateName,
    },
    sendEmail: true,
  });
};

/**
 * Send system maintenance notification
 * @param {number} roleId - Role ID (or null for all users)
 * @param {Object} maintenanceData - Maintenance information
 */
/**
 * Send licence information requested notification
 * @param {number} userId - Business user ID to notify
 * @param {Object} applicationData - Application information
 */
export const notifyLicenceInfoRequested = async (userId, applicationData) => {
  const safeType = applicationData?.type || 'Licence';
  const safeId = applicationData?.id || 'Unknown';
  const docs = applicationData?.requestedDocuments;
  const docsList = Array.isArray(docs) ? docs.join(', ') : (typeof docs === 'string' ? docs : '');
  
  let message = `The Admin has requested additional information/documents for your application #LIC-${safeId}.`;
  if (docsList) {
    message += `\n\nRequested Evidence: ${docsList}`;
  }
  message += `\n\nPlease review and upload the requested evidence through your dashboard.`;

  return await createNotification({
    userId,
    type: NotificationTypes.LICENCE_INFO_REQUESTED,
    priority: NotificationPriority.HIGH,
    title: `Action Required: Documents Requested for ${safeType} Application`,
    message: message,
    actionType: 'licence_info_request',
    entityId: applicationData?.id || null,
    entityType: 'licence_application',
    metadata: {
      applicationId: safeId,
      type: safeType,
      requestedDocs: docsList,
      adminNotes: applicationData.adminNotes || ''
    },
    sendEmail: true,
  });
};

export const notifyLicenceStatusChanged = async (userId, applicationData, status, notes = '') => {
  const safeId = applicationData?.id || 'Unknown';
  const company = applicationData?.companyName || 'Your business';
  const type = applicationData?.type || 'Licence';
  const adminNotes = notes || applicationData?.adminNotes || '';

  let message = `Your ${type} application for ${company} has been ${status.toLowerCase()}.`;
  if (adminNotes) {
    message += `\n\nDecision Notes: ${adminNotes}`;
  }

  return await createNotification({
    userId,
    type: NotificationTypes.LICENCE_STATUS_CHANGED,
    priority: status === 'Approved' ? NotificationPriority.HIGH : NotificationPriority.URGENT,
    title: `Licence Application ${status}: #LIC-${safeId}`,
    message: message,
    actionType: 'licence_status_update',
    entityId: applicationData?.id,
    entityType: 'licence_application',
    metadata: {
      applicationId: safeId,
      company: company,
      status: status,
      type: type,
      adminNotes: adminNotes,
      updatedAt: new Date().toLocaleString()
    },
    sendEmail: true,
  });
};

export const notifyLicenceAssigned = async (caseworkerId, applicationData) => {
  const safeId = applicationData?.id || 'Unknown';
  const company = applicationData?.companyName || 'A business';

  return await createNotification({
    userId: caseworkerId,
    type: NotificationTypes.LICENCE_ASSIGNED,
    priority: NotificationPriority.HIGH,
    title: `New Assignment: Licence Application #LIC-${safeId}`,
    message: `You have been assigned to review the licence application for ${company}.`,
    actionType: 'licence_assignment',
    entityId: applicationData?.id,
    entityType: 'licence_application',
    metadata: {
      applicationId: safeId,
      company: company,
      assignedAt: new Date().toLocaleString()
    },
    sendEmail: true,
  });
};

export const notifySystemMaintenance = async (roleId, maintenanceData) => {
  if (roleId) {
    const safeTitle = maintenanceData?.title || 'System Maintenance';
    const safeMessage = maintenanceData?.message || 'System maintenance is scheduled.';
    const safeScheduledStart = maintenanceData?.scheduledStart || 'Not specified';
    const safeScheduledEnd = maintenanceData?.scheduledEnd || 'Not specified';
    const safeNotifyBefore = maintenanceData?.notifyBefore || null;
    
    return await createNotificationForRole(roleId, {
      type: NotificationTypes.SYSTEM_MAINTENANCE,
      priority: NotificationPriority.HIGH,
      title: `Scheduled Maintenance: ${safeTitle}`,
      message: safeMessage,
      actionType: 'system_maintenance',
      metadata: {
        scheduledStart: safeScheduledStart,
        scheduledEnd: safeScheduledEnd,
      },
      sendEmail: true,
      scheduledFor: safeNotifyBefore,
    });
  }
  // If no roleId, create for all active users (optional implementation)
};

/**
 * Send message received notification
 * @param {number} receiverId - User ID who received the message
 * @param {Object} messageData - Message information
 * @param {Object} senderData - Sender information
 */
export const notifyMessageReceived = async (receiverId, messageData, senderData, skipAdminBroadcast = false) => {
  const safeSenderName = senderData?.first_name && senderData?.last_name 
    ? `${senderData.first_name} ${senderData.last_name}` 
    : senderData?.email || 'Unknown sender';
  const safeMessageContent = messageData?.content || 'No content';
  const safeCaseId = messageData?.caseId || null;
  const truncatedContent = safeMessageContent.length > 50 
    ? safeMessageContent.substring(0, 50) + '...' 
    : safeMessageContent;
  
  return await createNotification({
    userId: receiverId,
    type: NotificationTypes.MESSAGE_RECEIVED,
    priority: NotificationPriority.MEDIUM,
    title: `New Message from ${safeSenderName}`,
    message: `You have received a new message: "${truncatedContent}"`,
    actionType: 'message_received',
    entityId: messageData?.id || null,
    entityType: 'message',
    metadata: {
      senderId: senderData?.id,
      senderName: safeSenderName,
      conversationId: messageData?.conversationId,
      caseId: safeCaseId,
      messageType: messageData?.messageType || 'text',
    },
    sendEmail: false, // Typically don't send emails for messages to avoid spam
    isInternalAdminOnly: skipAdminBroadcast, // Prevent admin fanout for message notifications
  });
};

export const notifyTaskAssigned = async (userId, taskData) => {
  const safeTitle = taskData?.title || 'Unknown Task';
  const safeDueDate = taskData?.due_date ? new Date(taskData.due_date).toLocaleDateString() : 'No deadline';
  const safePriority = taskData?.priority || 'medium';

  return await createNotification({
    userId,
    type: NotificationTypes.INFO,
    priority: safePriority === 'high' ? NotificationPriority.HIGH : NotificationPriority.MEDIUM,
    title: `New Task Assigned: ${safeTitle}`,
    message: `You have been assigned a new task "${safeTitle}". Deadline: ${safeDueDate}.`,
    actionType: 'task_assigned',
    entityId: taskData?.id || null,
    entityType: 'task',
    metadata: {
      taskId: taskData?.id,
      title: safeTitle,
      dueDate: taskData?.due_date,
      priority: safePriority,
    },
    sendEmail: true,
  });
};

export default {
  createNotification,
  createBulkNotifications,
  createNotificationForRole,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
  getUserNotifications,
  processScheduledNotifications,
  deleteExpiredNotifications,
  NotificationTypes,
  NotificationPriority,
  // Event helpers
  notifyCaseAssigned,
  notifyTaskAssigned,
  notifyCaseStatusChanged,
  notifyPaymentReceived,
  notifyPaymentOverdue,
  notifyDocumentUploaded,
  notifyDocumentReviewed,
  notifyEscalationCreated,
  notifyEscalationResolved,
  notifyUserCreated,
  notifySLABreach,
  notifySystemMaintenance,
  notifyMessageReceived,
  createNotificationForAllUsers,
  notifyLicenceInfoRequested,
  notifyLicenceStatusChanged,
  notifyLicenceAssigned,
  notifyAdmins,
};
