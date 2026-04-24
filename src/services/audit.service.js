import db from "../models/index.js";

/**
 * Records a new audit log entry in the database.
 * 
 * @param {Object} params
 * @param {number|null} params.userId - The ID of the user performing the action (null for system/unauthenticated)
 * @param {string} params.action - The type of action (e.g., 'Login', 'Case Created')
 * @param {string} params.resource - The specific item affected (e.g., 'Case #CAS-123')
 * @param {string} params.status - 'Success', 'Failed', or 'Pending'
 * @param {string} params.details - Descriptive text about the action
 * @param {Object} params.req - (Optional) Express request object to automatically extract IP address
 */
export const recordAuditLog = async ({ userId, action, resource, status, details, req }) => {
  try {
    let ipAddress = null;
    if (req) {
      ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
      if (ipAddress && ipAddress.includes(',')) {
        ipAddress = ipAddress.split(',')[0].trim();
      }
    }

    await db.AuditLog.create({
      user_id: userId,
      action,
      resource,
      ip_address: ipAddress,
      status: status || 'Success',
      details
    });
  } catch (error) {
    // We console.error but don't throw to avoid crashing the main process if logging fails
    console.error("Failed to record audit log:", error);
  }
};
