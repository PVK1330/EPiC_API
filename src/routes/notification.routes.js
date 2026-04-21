import { Router } from 'express';
import * as notificationController from '../controllers/notification.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { checkRole, checkPermission, ROLES } from '../middlewares/role.middleware.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyToken);

// ==================== USER NOTIFICATION ROUTES ====================

// Get all notifications for authenticated user
router.get('/', notificationController.getNotifications);

// Get unread notification count
router.get('/unread-count', notificationController.getUnreadNotificationCount);

// Get notification statistics
router.get('/stats', notificationController.getNotificationStats);

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
