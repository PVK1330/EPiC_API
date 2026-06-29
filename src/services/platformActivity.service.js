import platformDb from "../models/index.js";
import logger from "../utils/logger.js";

/**
 * Record an audit log entry in the platform central database.
 *
 * The platform_audit_logs table carries both the legacy display columns
 * (category / user / org — all NOT NULL) and the newer structured columns
 * (user_id / details / ip_address). Callers may pass either style; this helper
 * always fills the NOT NULL legacy columns with safe defaults so a missing
 * optional field can never silently drop the row on a constraint violation.
 */
export const recordPlatformAuditLog = async ({
  category,    // Authentication, Organisation, Billing, System
  action,
  user,        // Email address or initiator (legacy display column, NOT NULL)
  org,         // Organisation name or "Global System" (legacy, NOT NULL)
  description,
  status,      // Success, Failed
  user_id,     // optional FK to users.id (structured column)
  details,     // optional structured details (falls back to description)
  ip_address,  // optional request IP
} = {}) => {
  try {
    await platformDb.PlatformAuditLog.create({
      category: category || "System",
      action,
      user: user || "System",
      org: org || "Global System",
      description: description ?? details ?? null,
      status: status || "Success",
      user_id: user_id ?? null,
      details: details ?? description ?? null,
      ip_address: ip_address ?? null,
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
