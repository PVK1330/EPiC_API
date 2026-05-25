import platformDb from "../../models/index.js";
import catchAsync from "../../utils/catchAsync.js";
import ApiResponse from "../../utils/apiResponse.js";

/**
 * GET /api/superadmin/notifications
 * Query params:
 *   - unreadOnly: boolean (true/false)
 */
export const listPlatformNotifications = catchAsync(async (req, res) => {
  const { unreadOnly } = req.query || {};
  
  const where = {};
  if (unreadOnly === "true") {
    where.isRead = false;
  }

  const notifications = await platformDb.PlatformNotification.findAll({
    where,
    order: [["created_at", "DESC"]]
  });

  return ApiResponse.success(res, "Platform notifications retrieved", {
    notifications
  });
});

/**
 * POST /api/superadmin/notifications/:id/read
 */
export const markPlatformNotificationRead = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return ApiResponse.badRequest(res, "Invalid notification id");
  }

  const notification = await platformDb.PlatformNotification.findByPk(id);
  if (!notification) {
    return ApiResponse.notFound(res, "Notification not found");
  }

  await notification.update({ isRead: true });

  return ApiResponse.success(res, "Notification marked as read", { notification });
});

/**
 * POST /api/superadmin/notifications/mark-all-read
 */
export const markAllPlatformNotificationsRead = catchAsync(async (req, res) => {
  await platformDb.PlatformNotification.update(
    { isRead: true },
    { where: { isRead: false } }
  );

  return ApiResponse.success(res, "All platform notifications marked as read");
});
