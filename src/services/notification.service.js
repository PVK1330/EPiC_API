import logger from '../utils/logger.js';
import { sendTransactionalEmail } from './mail.service.js';
import { ROLES } from '../middlewares/role.middleware.js';
import { getIO } from '../realtime/ioRegistry.js';
import { userRoom } from '../realtime/messagingRealtime.js';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const NotificationTypes = Object.freeze({
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
  // semantic aliases used across the codebase
  CASE_STATUS_CHANGED: 'info',
  PAYMENT_RECEIVED: 'success',
  SYSTEM_MAINTENANCE: 'warning',
  CANDIDATE_ISSUE_REPORT: 'warning',
  LICENCE_ASSIGNED: 'info',
});

export const NotificationPriority = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'critical',
  CRITICAL: 'critical',
});

// ─── Core helpers ─────────────────────────────────────────────────────────────

/**
 * Persist + optionally socket-deliver a single notification.
 * @param {object} tenantDb
 * @param {number} userId  - recipientId
 * @param {object} payload - { type, priority, title, message, category, actionUrl,
 *                            entityType, entityId, organisationId, metadata,
 *                            isInternalAdminOnly, sendEmail, actionType }
 */
export async function notifyUser(tenantDb, userId, payload = {}) {
  if (!tenantDb || !userId) return null;
  try {
    const {
      type = NotificationTypes.INFO,
      priority = NotificationPriority.MEDIUM,
      title = '',
      message = '',
      category = 'system',
      actionUrl = null,
      entityType = null,
      entityId = null,
      organisationId: payloadOrganisationId = null,
      metadata = {},
      sendEmail: doEmail = false,
      actionType = null,
    } = payload;

    // The notifications table is per-tenant but still carries organisation_id so
    // org-scoped list queries work. Most callers don't pass it, so derive it from
    // the recipient when missing — otherwise rows land with NULL organisation_id
    // and never appear in the org-filtered notifications list.
    let organisationId = payloadOrganisationId;
    if (organisationId == null) {
      const recipient = await tenantDb.User.findByPk(userId, {
        attributes: ['organisation_id'],
      }).catch(() => null);
      organisationId = recipient?.organisation_id ?? null;
    }

    // Resolve recipient delivery preferences (in-app + email + per-category).
    let sendSocket = true;
    let sendEmail = doEmail;
    let prefs = null;
    if (tenantDb.NotificationPreference) {
      prefs = await tenantDb.NotificationPreference.findOne({ where: { userId } }).catch(() => null);
      if (prefs) {
        if (!prefs.inAppNotifications) sendSocket = false;
        if (!prefs.emailNotifications) sendEmail = false;
        // Per-category overrides — silence both channels for the disabled category.
        if (category === 'case' && prefs.caseUpdates === false) { sendSocket = false; sendEmail = false; }
        if (category === 'payment' && prefs.paymentNotifications === false) { sendSocket = false; sendEmail = false; }
        if (category === 'appointment' && prefs.appointmentNotifications === false) { sendSocket = false; sendEmail = false; }
      }
    }

    const notification = await tenantDb.Notification.create({
      title: String(title).slice(0, 255),
      message: String(message),
      category,
      priority,
      type,
      userId,
      organisationId,
      actionType,
      entityType,
      entityId,
      actionUrl,
      metadata: { ...metadata, actionType },
      isRead: false,
      isArchived: false,
    });

    // Real-time delivery via the centralized Socket.IO instance (ioRegistry).
    // `tenantDb._io` is legacy/unused, so this resolves to getIO(). Honors the
    // recipient's in-app/category preferences (sendSocket).
    const io = tenantDb._io || getIO();
    if (io && sendSocket) {
      io.to(userRoom(userId)).emit('notification:new', notification.toJSON());
      const unread = await tenantDb.Notification.count({
        where: { userId, isRead: false },
      });
      io.to(userRoom(userId)).emit('notification:count', { count: unread });
    }

    if (sendEmail) {
      const user = await tenantDb.User.findByPk(userId, { attributes: ['email'] });
      if (user?.email) {
        await sendTransactionalEmail({
          organisationId,
          to: user.email,
          subject: title,
          html: `<p>${message}</p>`,
        }).catch((err) => logger.error({ err }, 'notifyUser email failed'));
      }
    }

    return notification;
  } catch (err) {
    logger.error({ err, userId, payload }, 'notifyUser failed');
    return null;
  }
}

/**
 * Notify all admin-role users in the tenant DB.
 */
export async function notifyAdmins(tenantDb, payload = {}) {
  if (!tenantDb) return [];
  try {
    const admins = await tenantDb.User.findAll({
      where: { role_id: ROLES.ADMIN, status: 'active' },
      attributes: ['id'],
    });
    return await Promise.all(admins.map((u) => notifyUser(tenantDb, u.id, payload)));
  } catch (err) {
    logger.error({ err }, 'notifyAdmins failed');
    return [];
  }
}

/**
 * Notify a user that a task has been assigned to them.
 * payload: { title, message, entityType, entityId, actionUrl, organisationId, metadata }
 */
export async function notifyTaskAssigned(tenantDb, assigneeId, payload = {}) {
  return notifyUser(tenantDb, assigneeId, {
    ...payload,
    type: NotificationTypes.INFO,
    priority: NotificationPriority.HIGH,
    category: 'workflow',
    actionType: 'task_assigned',
  });
}

/**
 * Notify all users with a given roleId that a new user has been created.
 * @param {object} tenantDb
 * @param {number} roleId
 * @param {object} payload - { title, message, ... }
 */
export async function notifyUserCreated(tenantDb, roleId, payload = {}) {
  if (!tenantDb || !roleId) return;
  try {
    const users = await tenantDb.User.findAll({
      where: { role_id: roleId, status: 'active' },
      attributes: ['id'],
    });
    await Promise.all(
      users.map((u) =>
        notifyUser(tenantDb, u.id, {
          ...payload,
          type: NotificationTypes.INFO,
          priority: NotificationPriority.MEDIUM,
          category: 'system',
          actionType: 'user_created',
        }),
      ),
    );
  } catch (err) {
    logger.error({ err }, 'notifyUserCreated failed');
  }
}

/**
 * Create a single notification (object-arg variant used by some controllers).
 * @param {object} opts - { tenantDb, userId, type, priority, title, message, ... }
 */
export async function createNotification({ tenantDb, userId, ...rest }) {
  return notifyUser(tenantDb, userId, rest);
}

/**
 * Bulk-create notifications for a list of user IDs.
 * @param {number[]} userIds
 * @param {object}   opts   - { tenantDb, ...notifyUser payload }
 */
/**
 * Notify admins that a new case has been created.
 * @param {object} tenantDb
 * @param {{ id: number, caseId: string, candidateName: string }} caseInfo
 */
/**
 * Notify a user that their licence application status has changed.
 * @param {number} userId
 * @param {object} application - licence application record
 * @param {string} [status]
 * @param {string} [adminNotes]
 */
// ─── DB query helpers (used by notification controller) ───────────────────────

/**
 * Paginated fetch of notifications for a user.
 */
export async function getUserNotifications(tenantDb, userId, { page = 1, limit = 20, unreadOnly = false, type, priority } = {}) {
  const where = { userId, isArchived: false };
  if (unreadOnly) where.isRead = false;
  if (type) where.type = type;
  if (priority) where.priority = priority;
  const offset = (page - 1) * limit;
  const { count, rows } = await tenantDb.Notification.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit,
    offset,
  });
  return { notifications: rows, total: count, page, totalPages: Math.ceil(count / limit) };
}

/**
 * Count unread notifications for a user.
 */
export async function getUnreadCount(tenantDb, userId) {
  return tenantDb.Notification.count({ where: { userId, isRead: false, isArchived: false } });
}

/**
 * Hard-delete a single notification by id.
 */
export async function deleteNotification(tenantDb, id) {
  return tenantDb.Notification.destroy({ where: { id } });
}

/**
 * Delete all notifications older than 90 days. Returns count deleted.
 */
export async function deleteExpiredNotifications(tenantDb) {
  const { Op } = await import('sequelize');
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  return tenantDb.Notification.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });
}

/**
 * No-op stub — scheduled notifications not yet implemented.
 */
export async function processScheduledNotifications(tenantDb) {
  return 0;
}

/**
 * Notify all users of a specific role.
 * @param {number} roleId
 * @param {object} opts - { tenantDb, ...payload }
 */
export async function createNotificationForRole(roleId, opts = {}) {
  const { tenantDb, ...payload } = opts;
  if (!tenantDb || !roleId) return [];
  const users = await tenantDb.User.findAll({
    where: { role_id: roleId, status: 'active' },
    attributes: ['id'],
  });
  return createBulkNotifications(users.map((u) => u.id), { tenantDb, ...payload });
}

/**
 * Broadcast notification to ALL active users in the tenant.
 * @param {object} opts - { tenantDb, ...payload }
 */
export async function createNotificationForAllUsers(opts = {}) {
  const { tenantDb, ...payload } = opts;
  if (!tenantDb) return [];
  const users = await tenantDb.User.findAll({ where: { status: 'active' }, attributes: ['id'] });
  return createBulkNotifications(users.map((u) => u.id), { tenantDb, ...payload });
}

// ─── Domain-specific notify helpers ───────────────────────────────────────────

export async function notifyDocumentUploaded(tenantDb, userId, data = {}) {
  return notifyUser(tenantDb, userId, {
    type: NotificationTypes.INFO,
    priority: NotificationPriority.MEDIUM,
    category: 'document',
    title: data.title ?? 'Document Uploaded',
    message: data.message ?? 'A document has been uploaded.',
    entityType: 'document',
    entityId: data.id ?? null,
    actionType: 'document_uploaded',
    metadata: data,
  });
}

export async function notifyDocumentReviewed(tenantDb, userId, data = {}, status) {
  return notifyUser(tenantDb, userId, {
    type: status === 'Approved' ? NotificationTypes.SUCCESS : NotificationTypes.WARNING,
    priority: NotificationPriority.HIGH,
    category: 'document',
    title: data.title ?? `Document ${status ?? 'Reviewed'}`,
    message: data.message ?? `Your document has been ${status ?? 'reviewed'}.`,
    entityType: 'document',
    entityId: data.id ?? null,
    actionType: 'document_reviewed',
    metadata: { ...data, status },
  });
}

export async function notifyDocumentSubmittedToCandidate(tenantDb, userId, data = {}) {
  return notifyUser(tenantDb, userId, {
    type: NotificationTypes.INFO,
    priority: NotificationPriority.MEDIUM,
    category: 'document',
    title: data.title ?? 'Document Submitted',
    message: data.message ?? 'A document has been submitted for your review.',
    entityType: 'document',
    entityId: data.id ?? null,
    actionType: 'document_submitted',
    metadata: data,
  });
}

export async function notifyMessageReceived(tenantDb, userId, data = {}, opts = {}) {
  // `data` may be a Sequelize model instance with circular include/parent refs,
  // which breaks JSONB serialization of metadata. Flatten to a plain object.
  const plain = typeof data?.get === 'function' ? data.get({ plain: true }) : data;
  return notifyUser(tenantDb, userId, {
    type: NotificationTypes.INFO,
    priority: NotificationPriority.MEDIUM,
    category: 'message',
    title: plain.title ?? 'New Message',
    message: plain.message ?? 'You have received a new message.',
    entityType: 'conversation',
    entityId: plain.conversationId ?? null,
    actionType: 'message_received',
    metadata: plain,
    ...opts,
  });
}

export async function notifyPaymentReceived(tenantDb, userId, data = {}) {
  return notifyUser(tenantDb, userId, {
    type: NotificationTypes.SUCCESS,
    priority: NotificationPriority.HIGH,
    category: 'payment',
    title: data.title ?? 'Payment Received',
    message: data.message ?? 'Your payment has been received.',
    entityType: 'payment',
    entityId: data.id ?? null,
    actionType: 'payment_received',
    metadata: data,
  });
}

export async function notifyCaseAssigned(tenantDb, userId, data = {}) {
  return notifyUser(tenantDb, userId, {
    type: NotificationTypes.INFO,
    priority: NotificationPriority.HIGH,
    category: 'case',
    title: data.title ?? `Case Assigned: ${data.caseId ?? ''}`,
    message: data.message ?? 'A case has been assigned to you.',
    entityType: 'case',
    entityId: data.id ?? null,
    actionType: 'case_assigned',
    metadata: data,
  });
}

export async function notifyCaseStatusChanged(tenantDb, userIds, data = {}, fromStatus, toStatus) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  return createBulkNotifications(ids.filter(Boolean), {
    tenantDb,
    type: NotificationTypes.INFO,
    priority: NotificationPriority.HIGH,
    category: 'case',
    title: data.title ?? `Case Status Updated`,
    message: data.message ?? `Case status changed${fromStatus ? ` from ${fromStatus}` : ''}${toStatus ? ` to ${toStatus}` : ''}.`,
    entityType: 'case',
    entityId: data.id ?? null,
    actionType: 'case_status_changed',
    metadata: { ...data, fromStatus, toStatus },
  });
}

export async function notifyProposedAmountToCandidate(tenantDb, userId, data = {}) {
  return notifyUser(tenantDb, userId, {
    type: NotificationTypes.INFO,
    priority: NotificationPriority.HIGH,
    category: 'case',
    title: data.title ?? 'Proposed Amount Updated',
    message: data.message ?? 'A proposed amount has been set for your case.',
    entityType: 'case',
    entityId: data.id ?? null,
    actionType: 'proposed_amount',
    metadata: data,
  });
}

export async function notifyEscalationCreated(tenantDb, userId, data = {}) {
  return notifyUser(tenantDb, userId, {
    type: NotificationTypes.WARNING,
    priority: NotificationPriority.HIGH,
    category: 'case',
    title: data.title ?? 'Escalation Created',
    message: data.message ?? 'A new escalation has been assigned to you.',
    entityType: 'escalation',
    entityId: data.id ?? null,
    actionType: 'escalation_created',
    metadata: data,
  });
}

export async function notifyEscalationResolved(tenantDb, userIds, data = {}) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  return createBulkNotifications(ids.filter(Boolean), {
    tenantDb,
    type: NotificationTypes.SUCCESS,
    priority: NotificationPriority.MEDIUM,
    category: 'case',
    title: data.title ?? 'Escalation Resolved',
    message: data.message ?? `Escalation resolved: ${data.resolution ?? ''}`,
    entityType: 'escalation',
    entityId: data.id ?? null,
    actionType: 'escalation_resolved',
    metadata: data,
  });
}

export async function notifyCaseCreated(tenantDb, { id, caseId, candidateName } = {}) {
  return notifyAdmins(tenantDb, {
    type: NotificationTypes.INFO,
    priority: NotificationPriority.MEDIUM,
    category: 'case',
    title: `New Case Created: ${caseId ?? ''}`,
    message: `A new case has been created for ${candidateName ?? 'a candidate'}.`,
    entityType: 'case',
    entityId: id ?? null,
    actionType: 'case_created',
  });
}

export async function createBulkNotifications(userIds, opts = {}) {
  const { tenantDb, ...payload } = opts;
  if (!tenantDb || !Array.isArray(userIds) || !userIds.length) return [];
  const results = await Promise.all(
    userIds.map((id) => notifyUser(tenantDb, id, payload)),
  );
  return results.filter(Boolean);
}

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

    // Derive organisation_id from the recipient when the caller didn't supply it,
    // so the notification is visible in org-scoped list queries (see notifyUser).
    let resolvedOrganisationId = organisationId;
    if (resolvedOrganisationId == null && recipientId) {
      const recipient = await tenantDb.User.findByPk(recipientId, {
        attributes: ['organisation_id'],
      }).catch(() => null);
      resolvedOrganisationId = recipient?.organisation_id ?? null;
    }

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

    // 3. Save to Database (canonical columns: userId / roleId)
    const notification = await tenantDb.Notification.create({
      title,
      message,
      category,
      priority,
      type,
      userId: recipientId,
      roleId: recipientRole,
      organisationId: resolvedOrganisationId,
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

    // 6. Deliver via Socket.IO (prefer the explicit context io, else the
    //    centralized registry instance).
    const ioInstance = io || getIO();
    if (sendSocket && ioInstance && recipientId) {
      ioInstance.to(userRoom(recipientId)).emit('notification:new', notification);

      // Update unread count
      const unreadCount = await tenantDb.Notification.count({ where: { userId: recipientId, isRead: false } });
      ioInstance.to(userRoom(recipientId)).emit('notification:count', { count: unreadCount });

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
    { where: { userId, isRead: false } }
  );
};

/**
 * Archive (or un-archive) a single notification. Archived notifications are
 * hidden from the default list/unread queries.
 */
export const setNotificationArchived = async (tenantDb, notificationId, archived = true) => {
  const notification = await tenantDb.Notification.findByPk(notificationId);
  if (notification) {
    await notification.update({ isArchived: Boolean(archived) });
  }
  return notification;
};

export default {
  generateNotification,
  markAsRead,
  markAllAsRead,
  setNotificationArchived,
  notifyUser,
  notifyAdmins,
  notifyTaskAssigned,
  notifyUserCreated,
  createNotification,
  createBulkNotifications,
  // DB helpers
  getUserNotifications,
  getUnreadCount,
  deleteNotification,
  deleteExpiredNotifications,
  processScheduledNotifications,
  createNotificationForRole,
  createNotificationForAllUsers,
  // domain helpers
  notifyDocumentUploaded,
  notifyDocumentReviewed,
  notifyDocumentSubmittedToCandidate,
  notifyMessageReceived,
  notifyPaymentReceived,
  notifyCaseAssigned,
  notifyCaseStatusChanged,
  notifyProposedAmountToCandidate,
  notifyEscalationCreated,
  notifyEscalationResolved,
  notifyCaseCreated,
  NotificationTypes,
  NotificationPriority,
};
