import { markAsRead } from '../services/notification.service.js';
import logger from '../utils/logger.js';

export default function registerNotificationHandlers(io, socket) {
  // Assume socket.user and socket.tenantDb are populated by auth middleware
  
  socket.on('notification:read', async (data, callback) => {
    try {
      const { notificationId } = data;
      if (!socket.tenantDb || !notificationId) return;

      const notification = await markAsRead(socket.tenantDb, notificationId);
      
      // Emit the updated count
      const unreadCount = await socket.tenantDb.Notification.count({ 
        where: { recipientId: socket.user.userId, isRead: false } 
      });
      
      io.to(`user:${socket.user.userId}`).emit('notification:count', { count: unreadCount });
      
      if (typeof callback === 'function') {
        callback({ status: 'success', notification });
      }
    } catch (error) {
      logger.error({ err: error }, 'Error in notification:read socket handler');
      if (typeof callback === 'function') {
        callback({ status: 'error', message: error.message });
      }
    }
  });

  socket.on('notification:delete', async (data, callback) => {
    try {
      const { notificationId } = data;
      if (!socket.tenantDb || !notificationId) return;

      await socket.tenantDb.Notification.destroy({ 
        where: { id: notificationId, recipientId: socket.user.userId } 
      });

      // Emit the updated count
      const unreadCount = await socket.tenantDb.Notification.count({ 
        where: { recipientId: socket.user.userId, isRead: false } 
      });
      
      io.to(`user:${socket.user.userId}`).emit('notification:count', { count: unreadCount });
      
      if (typeof callback === 'function') {
        callback({ status: 'success' });
      }
    } catch (error) {
      logger.error({ err: error }, 'Error in notification:delete socket handler');
      if (typeof callback === 'function') {
        callback({ status: 'error', message: error.message });
      }
    }
  });
}
