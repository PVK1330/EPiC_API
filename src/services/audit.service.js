// Track which tenant DBs have had audit_logs columns ensured
const _auditColsReady = new Set();

async function ensureAuditLogColumns(sequelize) {
  const key = sequelize.config?.database || 'default';
  if (_auditColsReady.has(key)) return;
  await sequelize.query(
    "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource VARCHAR(255)",
  ).catch(() => {});
  await sequelize.query(
    "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'Success'",
  ).catch(() => {});
  await sequelize.query(
    "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details TEXT",
  ).catch(() => {});
  _auditColsReady.add(key);
}

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

    // Ensure columns exist before writing
    await ensureAuditLogColumns(tenantDb.sequelize);

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
    console.error('Failed to record audit log:', error);
  }
};
