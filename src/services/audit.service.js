import logger from "../utils/logger.js";



/**
 * Records a new audit log entry in the tenant database.
 */
export const recordAuditLog = async ({
  tenantDb,
  userId,
  action,
  resource,
  status,
  details,
  req,
  organisationId,
}) => {
  try {
    if (!tenantDb) return;

    let ipAddress = null;
    if (req) {
      ipAddress = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
      if (ipAddress && ipAddress.includes(',')) {
        ipAddress = ipAddress.split(',')[0].trim();
      }
    }

    const organisation_id =
      organisationId ??
      (req?.user?.organisation_id != null ? Number(req.user.organisation_id) : null);

    await tenantDb.AuditLog.create({
      user_id:         userId,
      organisation_id: Number.isNaN(organisation_id) ? null : organisation_id,
      action,
      resource,
      ip_address:      ipAddress,
      status:          status || 'Success',
      details,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to record audit log");
  }
};
