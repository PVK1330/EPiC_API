import { Op } from 'sequelize';

/**
 * Build the date-range where clause from a dateRange query param.
 */
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

// Track which tenant DBs have already had their columns ensured this process lifetime
const _auditColsEnsured = new Set();

/**
 * Ensure the audit_logs table has the columns the model expects.
 * Runs ALTER TABLE only once per tenant DB per process — cached after first call.
 */
async function ensureAuditLogColumns(sequelize) {
  const key = sequelize.config?.database || sequelize.getDatabaseName?.() || 'default';
  if (_auditColsEnsured.has(key)) return;

  await sequelize.query(
    "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource VARCHAR(255)",
  ).catch(() => {});
  await sequelize.query(
    "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'Success'",
  ).catch(() => {});
  await sequelize.query(
    "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details TEXT",
  ).catch(() => {});

  _auditColsEnsured.add(key);
}

/**
 * Format a raw AuditLog row into the shape the frontend expects.
 */
function formatLog(log) {
  const userObj = log.user;
  let userName = 'System';
  let initials  = 'SY';
  let roleName  = 'System';

  if (userObj) {
    userName = `${userObj.first_name || ''} ${userObj.last_name || ''}`.trim() || 'Unknown';
    initials  = `${userObj.first_name?.[0] || ''}${userObj.last_name?.[0] || ''}`.toUpperCase() || 'UK';
    roleName  = userObj.role?.name || 'User';
  }

  return {
    id:           log.id,
    timestamp:    new Date(log.created_at).toLocaleString(),
    userName,
    initials,
    user:         userName,
    role:         roleName,
    action:       log.action || '',
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

// ─── GET /audit-logs  (list with filters + pagination) ───────────────────────
export const getAuditLogs = async (req, res) => {
  try {
    const {
      page       = 1,
      limit      = 50,
      dateRange  = 'last7',
      actionType = 'all',
      user       = 'all',
      status     = 'all',
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page,  10) || 1);
    const limitNum = Math.min(200, parseInt(limit, 10) || 50);
    const offset   = (pageNum - 1) * limitNum;

    // Ensure columns exist (idempotent — safe on every call)
    await ensureAuditLogColumns(req.tenantDb.sequelize);

    const whereClause = { ...buildDateWhere(dateRange) };

    // Action filter
    if (actionType !== 'all') {
      if (actionType === 'login') {
        whereClause.action = { [Op.iLike]: '%Login%' };
      } else if (actionType === 'user_mgmt') {
        whereClause.action = { [Op.iLike]: '%User%' };
      } else {
        whereClause.action = { [Op.iLike]: `%${actionType}%` };
      }
    }

    // Status filter
    if (status !== 'all') {
      whereClause.status = status;
    }

    // User include (with optional name filter)
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

    if (user && user !== 'all') {
      const parts     = user.trim().split(/\s+/);
      const firstName = parts[0];
      const lastName  = parts.slice(1).join(' ');
      if (firstName && lastName) {
        userInclude.where = {
          first_name: { [Op.iLike]: `%${firstName}%` },
          last_name:  { [Op.iLike]: `%${lastName}%`  },
        };
      } else {
        userInclude.where = {
          [Op.or]: [
            { first_name: { [Op.iLike]: `%${firstName}%` } },
            { last_name:  { [Op.iLike]: `%${firstName}%` } },
          ],
        };
      }
      userInclude.required = true;
    }

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
      message: 'Audit logs retrieved successfully',
      data:    formattedLogs,          // flat array — frontend reads response.data.data
      meta: {
        pagination: {
          total: count,
          page:  pageNum,
          limit: limitNum,
          pages: Math.ceil(count / limitNum),
        },
      },
    });
  } catch (error) {
    console.error('Get Audit Logs Error:', error);
    res.status(500).json({
      status:  'error',
      message: 'Internal server error',
      data:    null,
      error:   error.message,
    });
  }
};

// ─── GET /audit-logs/stats  (summary counts) ─────────────────────────────────
export const getAuditStats = async (req, res) => {
  try {
    // Ensure columns exist before querying them
    await ensureAuditLogColumns(req.tenantDb.sequelize);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [total, successful, failed, today] = await Promise.all([
      req.tenantDb.AuditLog.count(),
      req.tenantDb.AuditLog.count({ where: { status: 'Success' } }),
      req.tenantDb.AuditLog.count({ where: { status: 'Failed'  } }),
      req.tenantDb.AuditLog.count({ where: { created_at: { [Op.gte]: todayStart } } }),
    ]);

    res.status(200).json({
      status:  'success',
      message: 'Audit stats retrieved successfully',
      data: {
        total_activities: total,
        successful_count: successful,
        failed_count:     failed,
        today_count:      today,
        total,
        success: successful,
        failed,
      },
    });
  } catch (error) {
    console.error('Get Audit Stats Error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── GET /audit-logs/actions  (distinct action types) ────────────────────────
export const getAuditActionTypes = async (req, res) => {
  try {
    const actions = await req.tenantDb.AuditLog.findAll({
      attributes: [
        [req.tenantDb.Sequelize.fn('DISTINCT', req.tenantDb.Sequelize.col('action')), 'action'],
      ],
      order: [['action', 'ASC']],
    });

    res.status(200).json({
      status: 'success',
      data:   actions.map(a => a.action).filter(Boolean),
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── GET /audit-logs/export  (CSV download) ───────────────────────────────────
export const exportAuditLogs = async (req, res) => {
  try {
    const { dateRange = 'all', status = 'all' } = req.query;

    // Ensure columns exist before querying them
    await ensureAuditLogColumns(req.tenantDb.sequelize);

    const whereClause = { ...buildDateWhere(dateRange) };
    if (status !== 'all') whereClause.status = status;

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

    const esc = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
    let csv = '\uFEFFTimestamp,User,Action,Resource,IP Address,Status,Details\n';

    logs.forEach(log => {
      const userName = log.user
        ? `${log.user.first_name || ''} ${log.user.last_name || ''}`.trim()
        : 'System';
      csv += [
        esc(new Date(log.created_at).toLocaleString()),
        esc(userName),
        esc(log.action),
        esc(log.resource || log.entity_type),
        esc(log.ip_address),
        esc(log.status),
        esc(log.details),
      ].join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=Audit_Export_${new Date().toISOString().slice(0, 10)}.csv`,
    );
    return res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
