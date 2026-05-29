import { Op } from 'sequelize';
import { rowsToXlsxBuffer, sendXlsxDownload } from '../../../utils/excelExport.util.js';

function buildDateWhere(dateRange) {
  const today = new Date();
  if (!dateRange || dateRange === 'all' || dateRange === 'custom') return {};
  const startDate = new Date();
  if (dateRange === 'last7')        startDate.setDate(today.getDate() - 7);
  else if (dateRange === 'last30')  startDate.setDate(today.getDate() - 30);
  else if (dateRange === 'last90')  startDate.setDate(today.getDate() - 90);
  else if (dateRange === 'last365') startDate.setDate(today.getDate() - 365);
  else return {};
  return { created_at: { [Op.gte]: startDate } };
}

const _auditColsEnsured = new Set();

async function ensureAuditLogColumns(sequelize) {
  const key = sequelize.config?.database || sequelize.getDatabaseName?.() || 'default';
  if (_auditColsEnsured.has(key)) return;

  await sequelize.query("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource VARCHAR(255)").catch(() => {});
  await sequelize.query("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'Success'").catch(() => {});
  await sequelize.query("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details TEXT").catch(() => {});

  _auditColsEnsured.add(key);
}

function formatLog(log) {
  const userObj = log.user;
  let userName = 'System';
  let initials  = 'SY';
  let roleName  = log.role || 'System';

  if (userObj) {
    userName = `${userObj.first_name || ''} ${userObj.last_name || ''}`.trim() || 'Unknown';
    initials  = `${userObj.first_name?.[0] || ''}${userObj.last_name?.[0] || ''}`.toUpperCase() || 'UK';
    roleName  = log.role || userObj.role?.name || 'User';
  }

  return {
    id:           log.id,
    timestamp:    new Date(log.created_at).toLocaleString(),
    userName,
    initials,
    user:         userName,
    role:         roleName,
    action:       log.action || '',
    entity_type:  log.entity_type || '-',
    entity_id:    log.entity_id || '-',
    field_name:   log.field_name || '-',
    resourceType: log.resource || log.entity_type || '-',
    resource:     log.resource || log.entity_type || '-',
    ipAddress:    log.ip_address || '-',
    ip:           log.ip_address || '-',
    status:       log.status || 'Success',
    details:      log.details || '',
    old_value:    log.old_value || null,
    new_value:    log.new_value || null,
  };
}

export const getAuditLogs = async (req, res) => {
  try {
    const {
      page       = 1,
      limit      = 50,
      action,
      status,
      startDate,
      endDate,
      userId,
      role,
      entityType,
      entityId
    } = req.query;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    const offset = (pageNum - 1) * limitNum;

    const whereClause = {};
    if (action) whereClause.action = action;
    if (status) whereClause.status = status;
    if (userId) whereClause.user_id = userId;
    if (role) whereClause.role = role;
    if (entityType) whereClause.entity_type = entityType;
    if (entityId) whereClause.entity_id = entityId;

    if (startDate && endDate) {
      whereClause.created_at = {
        [Op.between]: [new Date(startDate), new Date(endDate)],
      };
    } else if (startDate) {
      whereClause.created_at = { [Op.gte]: new Date(startDate) };
    } else if (endDate) {
      whereClause.created_at = { [Op.lte]: new Date(endDate) };
    }

    await ensureAuditLogColumns(req.tenantDb.sequelize);

    const userInclude = {
      model:      req.tenantDb.User,
      as:         'user',
      attributes: ['id', 'first_name', 'last_name'],
      required:   false,
      include: [{
        model:      req.tenantDb.Role,
        as:         'role',
        attributes: ['name'],
      }],
    };

    const { count, rows: auditLogs } = await req.tenantDb.AuditLog.findAndCountAll({
      where:    whereClause,
      include:  [userInclude],
      order:    [['created_at', 'DESC']],
      limit:    limitNum,
      offset,
      distinct: true,
      subQuery: false,
    });

    const formattedLogs = auditLogs.map(formatLog);

    res.status(200).json({
      status:  'success',
      data:    formattedLogs,
      meta: {
        total: count,
        page:  pageNum,
        limit: limitNum,
        pages: Math.ceil(count / limitNum),
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const exportAuditLogs = async (req, res) => {
  try {
    const { action, status, startDate, endDate, userId, role, entityType, entityId } = req.query;

    await ensureAuditLogColumns(req.tenantDb.sequelize);

    const whereClause = {};
    if (action) whereClause.action = action;
    if (status) whereClause.status = status;
    if (userId) whereClause.user_id = userId;
    if (role) whereClause.role = role;
    if (entityType) whereClause.entity_type = entityType;
    if (entityId) whereClause.entity_id = entityId;

    if (startDate && endDate) {
      whereClause.created_at = { [Op.between]: [new Date(startDate), new Date(endDate)] };
    } else if (startDate) {
      whereClause.created_at = { [Op.gte]: new Date(startDate) };
    } else if (endDate) {
      whereClause.created_at = { [Op.lte]: new Date(endDate) };
    }

    const logs = await req.tenantDb.AuditLog.findAll({
      where:   whereClause,
      include: [{
        model:      req.tenantDb.User,
        as:         'user',
        attributes: ['first_name', 'last_name'],
        required:   false,
      }],
      order: [['created_at', 'DESC']],
    });

    const columns = [
      { key: 'timestamp', header: 'Timestamp' },
      { key: 'userName', header: 'Changed By' },
      { key: 'role', header: 'Role' },
      { key: 'action', header: 'Action' },
      { key: 'entity_type', header: 'Entity' },
      { key: 'entity_id', header: 'Entity ID' },
      { key: 'field_name', header: 'Field' },
      { key: 'old_value', header: 'Old Value' },
      { key: 'new_value', header: 'New Value' },
      { key: 'ip', header: 'IP Address' },
      { key: 'status', header: 'Status' }
    ];

    const rows = logs.map(log => {
      const userName = log.user ? `${log.user.first_name || ''} ${log.user.last_name || ''}`.trim() : 'System';
      return {
        timestamp: new Date(log.created_at).toLocaleString(),
        userName,
        role: log.role || '',
        action: log.action || '',
        entity_type: log.entity_type || '',
        entity_id: log.entity_id || '',
        field_name: log.field_name || '',
        old_value: typeof log.old_value === 'object' ? JSON.stringify(log.old_value) : (log.old_value || ''),
        new_value: typeof log.new_value === 'object' ? JSON.stringify(log.new_value) : (log.new_value || ''),
        ip: log.ip_address || '',
        status: log.status || '',
      };
    });

    const buffer = rowsToXlsxBuffer(rows, columns);
    const filename = `Audit_Export_${new Date().toISOString().slice(0, 10)}.xlsx`;
    sendXlsxDownload(res, buffer, filename);
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
