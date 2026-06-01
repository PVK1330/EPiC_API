import { markAsRead } from '../services/notification.service.js';
import { getSocketTenantDb } from './socketTenantDb.js';
import { userRoom } from './messagingRealtime.js';
import logger from '../utils/logger.js';

/**
 * Register client→server notification socket handlers for a connected socket.
 * The authenticated user id is `socket.user.userId` (the JWT payload field),
 * and the tenant DB is resolved lazily from the socket's organisation context.
 *
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export default function registerNotificationHandlers(io, socket) {
  const uid = Number(socket.user?.userId);
  if (!Number.isFinite(uid) || uid <= 0) return;

  socket.on('notification:read', async (data, callback) => {
    try {
      const tenantDb = await getSocketTenantDb(socket);
      const notificationId = data?.notificationId;
      if (!tenantDb || !notificationId) return;

      await markAsRead(tenantDb, notificationId);

      const unreadCount = await tenantDb.Notification.count({
        where: { userId: uid, isRead: false },
      });
      io.to(userRoom(uid)).emit('notification:count', { count: unreadCount });

      if (typeof callback === 'function') callback({ status: 'success' });
    } catch (error) {
      logger.error({ err: error }, 'Error in notification:read socket handler');
      if (typeof callback === 'function') callback({ status: 'error', message: error.message });
    }
  });

  socket.on('notification:delete', async (data, callback) => {
    try {
      const tenantDb = await getSocketTenantDb(socket);
      const notificationId = data?.notificationId;
      if (!tenantDb || !notificationId) return;

      // Ownership-scoped delete (userId) prevents deleting another user's row.
      await tenantDb.Notification.destroy({
        where: { id: notificationId, userId: uid },
      });

      const unreadCount = await tenantDb.Notification.count({
        where: { userId: uid, isRead: false },
      });
      io.to(userRoom(uid)).emit('notification:count', { count: unreadCount });

      if (typeof callback === 'function') callback({ status: 'success' });
    } catch (error) {
      logger.error({ err: error }, 'Error in notification:delete socket handler');
      if (typeof callback === 'function') callback({ status: 'error', message: error.message });
    }
  });
}
