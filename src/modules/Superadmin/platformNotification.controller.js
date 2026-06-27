import platformDb from "../../models/index.js";
import catchAsync from "../../utils/catchAsync.js";
import ApiResponse from "../../utils/apiResponse.js";

// Allowed values mirror the PlatformNotification `type` ENUM. An unrecognised
// value is ignored (treated as "no type filter") rather than erroring, so a
// stale/garbage query param degrades gracefully instead of 500-ing.
const VALID_NOTIFICATION_TYPES = new Set(["info", "success", "warning", "error"]);

/**
 * GET /api/superadmin/notifications
 * Query params:
 *   - unreadOnly: boolean (true/false)
 *   - type: info | success | warning | error (optional)
 *   - page: number (1-based, default 1)
 *   - limit: number (page size, default 20, max 200)
 */
export const listPlatformNotifications = catchAsync(async (req, res) => {
  const { unreadOnly, type, page, limit } = req.query || {};

  const where = {};
  if (unreadOnly === "true") {
    where.isRead = false;
  }
  if (type && VALID_NOTIFICATION_TYPES.has(type)) {
    where.type = type;
  }

  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const parsedLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 200);

  const { count, rows: notifications } =
    await platformDb.PlatformNotification.findAndCountAll({
      where,
      order: [["created_at", "DESC"]],
      limit: parsedLimit,
      offset: (parsedPage - 1) * parsedLimit,
    });

  return ApiResponse.success(res, "Platform notifications retrieved", {
    notifications,
    pagination: {
      total: count,
      page: parsedPage,
      limit: parsedLimit,
      pages: Math.ceil(count / parsedLimit),
    },
  });
});

/**
 * GET /api/superadmin/notifications/unread-count
 */
export const getUnreadCount = catchAsync(async (req, res) => {
  const count = await platformDb.PlatformNotification.count({
    where: { isRead: false },
  });

  return ApiResponse.success(res, "Unread count retrieved", { unreadCount: count });
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
