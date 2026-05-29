import platformDb from "../models/index.js";
import logger from "../utils/logger.js";

/**
 * Record an audit log entry in the platform central database.
 */
export const recordPlatformAuditLog = async ({
  category, // Authentication, Organisation, Billing, System
  action,
  user,     // Email address or initiator
  org,      // Organisation name or "Global System"
  description,
  status    // Success, Failed
}) => {
  try {
    await platformDb.PlatformAuditLog.create({
      category,
      action,
      user: user || "System",
      org: org || "Global System",
      description,
      status: status || "Success"
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to record platform audit log");
  }
};

/**
 * Create a platform-wide notification.
 */
export const createPlatformNotification = async ({
  title,
  desc,
  type // success, warning, error, info
}) => {
  try {
    await platformDb.PlatformNotification.create({
      title,
      desc,
      type: type || "info",
      isRead: false
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to create platform notification");
  }
};
