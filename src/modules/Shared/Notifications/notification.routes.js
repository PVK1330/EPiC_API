import { Router } from 'express';
import * as notificationController from './notification.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, checkPermission, ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyTokenAndTenant);

// ==================== USER NOTIFICATION ROUTES ====================

// Get all notifications for authenticated user
router.get('/', notificationController.getNotifications);

// Get unread notification count
router.get('/unread-count', notificationController.getUnreadNotificationCount);

// Get notification statistics
router.get('/stats', notificationController.getNotificationStats);

// Get / update the authenticated user's notification preferences
router.get('/preferences', notificationController.getNotificationPreferences);
router.patch('/preferences', notificationController.updateNotificationPreferences);

// Mark a specific notification as read
router.patch('/:id/mark-read', notificationController.markNotificationAsRead);

// Mark all notifications as read
router.patch('/mark-all-read', notificationController.markAllNotificationsAsRead);

// Delete a specific notification
router.delete('/:id', notificationController.deleteNotificationById);

// ==================== ADMIN NOTIFICATION ROUTES ====================

// Admin routes prefix
const adminRouter = Router();

// Apply role-based access control - Admin only
adminRouter.use(checkRole([ROLES.ADMIN]));

// Get all notifications in the system (admin view)
adminRouter.get('/all', notificationController.getAllNotifications);

// Create manual notification (broadcast)
adminRouter.post('/create', checkPermission('admin.notifications.manage'), notificationController.createManualNotification);

// Get notification statistics (admin)
adminRouter.get('/stats', notificationController.getNotificationStats);

// Process scheduled notifications (cron job endpoint - admin only)
adminRouter.post('/process-scheduled', notificationController.processScheduled);

// Delete expired notifications (cron job endpoint - admin only)
adminRouter.delete('/delete-expired', notificationController.deleteExpired);

router.use('/admin', adminRouter);

export default router;
