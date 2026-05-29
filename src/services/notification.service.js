import logger from '../utils/logger.js';
import { sendTransactionalEmail } from './mail.service.js';

/**
 * Enterprise Centralized Notification Service
 * Handles DB persistence, real-time socket delivery, email, audit, and timeline integration.
 */

/**
 * Generate a new notification and trigger delivery channels.
 * @param {Object} context - { tenantDb, io, req }
 * @param {Object} payload - Notification payload
 */
export const generateNotification = async (context, payload) => {
  const { tenantDb, io } = context;
  const {
    templateCode,
    recipientId,
    recipientRole,
    organisationId,
    entityType,
    entityId,
    actionUrl,
    category,
    priority,
    type,
    templateData = {}
  } = payload;

  try {
    if (!tenantDb) throw new Error('tenantDb is required for tenant-level notifications');

    // 1. Fetch Template
    const template = await tenantDb.NotificationTemplate.findOne({ where: { code: templateCode } });
    if (!template) {
      logger.warn(`Notification template not found for code: ${templateCode}`);
      return null;
    }

    // 2. Hydrate Templates with templateData (simple variable replacement)
    let title = template.title;
    let message = template.inAppTemplate || '';
    let emailSubject = template.emailSubject || template.title;
    let emailHtml = template.emailTemplate || '';

    Object.keys(templateData).forEach(key => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      title = title.replace(regex, templateData[key]);
      message = message.replace(regex, templateData[key]);
      emailSubject = emailSubject.replace(regex, templateData[key]);
      emailHtml = emailHtml.replace(regex, templateData[key]);
    });

    // 3. Save to Database
    const notification = await tenantDb.Notification.create({
      title,
      message,
      category,
      priority,
      type,
      recipientId,
      recipientRole,
      organisationId,
      entityType,
      entityId,
      actionUrl,
      isRead: false,
      isArchived: false
    });

    // 4. Fetch User Preferences
    let sendEmail = true;
    let sendSocket = true;
    if (recipientId) {
      const prefs = await tenantDb.NotificationPreference.findOne({ where: { userId: recipientId } });
      if (prefs) {
        if (!prefs.inAppNotifications) sendSocket = false;
        if (!prefs.emailNotifications) sendEmail = false;
        
        // Category specific overrides
        if (category === 'case' && prefs.caseUpdates === false) { sendEmail = false; sendSocket = false; }
        if (category === 'payment' && prefs.paymentNotifications === false) { sendEmail = false; sendSocket = false; }
        if (category === 'appointment' && prefs.appointmentNotifications === false) { sendEmail = false; sendSocket = false; }
      }
    }

    // 5. Track Delivery
    const delivery = await tenantDb.NotificationDelivery.create({
      notificationId: notification.id,
      deliveryStatus: 'pending'
    });

    // 6. Deliver via Socket.IO
    if (sendSocket && io && recipientId) {
      io.to(`user:${recipientId}`).emit('notification:new', notification);
      
      // Update unread count
      const unreadCount = await tenantDb.Notification.count({ where: { recipientId, isRead: false } });
      io.to(`user:${recipientId}`).emit('notification:count', { count: unreadCount });
      
      await delivery.update({ socketDelivered: true, socketDeliveredAt: new Date() });
    }

    // 7. Deliver via Email
    if (sendEmail && recipientId) {
      const user = await tenantDb.User.findByPk(recipientId, { attributes: ['email'] });
      if (user && user.email) {
        try {
          await sendTransactionalEmail({
            organisationId,
            to: user.email,
            subject: emailSubject,
            html: emailHtml || message, // Fallback to message if no specific HTML template
          });
          await delivery.update({ emailSent: true, emailSentAt: new Date(), deliveryStatus: 'delivered' });
        } catch (emailErr) {
          logger.error({ err: emailErr }, 'Failed to send notification email');
          await delivery.update({ deliveryStatus: 'failed' });
        }
      }
    }

    return notification;
  } catch (error) {
    logger.error({ err: error, payload }, 'Error in generateNotification');
    throw error;
  }
};

export const markAsRead = async (tenantDb, notificationId) => {
  const notification = await tenantDb.Notification.findByPk(notificationId);
  if (notification) {
    await notification.update({ isRead: true, readAt: new Date() });
  }
  return notification;
};

export const markAllAsRead = async (tenantDb, userId) => {
  return await tenantDb.Notification.update(
    { isRead: true, readAt: new Date() },
    { where: { recipientId: userId, isRead: false } }
  );
};

export default {
  generateNotification,
  markAsRead,
  markAllAsRead
};
