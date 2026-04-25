import db from '../models/index.js';
import { Op } from 'sequelize';
import { write as writeCsv } from 'fast-csv';

/**
 * Format date to string (YYYY-MM-DD HH:mm:ss)
 */
const formatDate = (date, format) => {
    if (!date) return '';
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');

    if (format === 'yyyy-MM-dd_HH-mm-ss') {
        return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
    }
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

/**
 * Calculate date range based on filter
 */
const getDateRange = (dateRange) => {
    const now = new Date();
    let startDate;

    switch (dateRange) {
        case '7d':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
        case '30d':
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
        case '3m':
            startDate = new Date(now.getTime() - 3 * 30 * 24 * 60 * 60 * 1000);
            break;
        case '1y':
            startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
            break;
        default:
            // Default to last 7 days
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    return { startDate, endDate: now };
};

/**
 * Build filter conditions for audit logs
 */
const buildFilterConditions = (filters) => {
    const conditions = {};

    // Date range filter
    if (filters.date_range && filters.date_range !== 'all') {
        const { startDate, endDate } = getDateRange(filters.date_range);
        conditions.createdAt = {
            [Op.between]: [startDate, endDate],
        };
    }

    // Action filter
    if (filters.action && filters.action !== 'ALL') {
        if (filters.action === 'USER_MANAGEMENT') {
            conditions.action = {
                [Op.in]: ['USER_CREATED', 'USER_UPDATED'],
            };
        } else {
            conditions.action = filters.action;
        }
    }

    // User ID filter
    if (filters.user_id && filters.user_id !== 'ALL') {
        conditions.user_id = parseInt(filters.user_id);
    }

    // Status filter
    if (filters.status && filters.status !== 'ALL') {
        conditions.status = filters.status;
    }

    return conditions;
};

/**
 * Get audit logs with filters and pagination
 * GET /api/audit-logs
 */
export const getAuditLogs = async (req, res) => {
    try {
        const {
            date_range = '7d',
            action = 'ALL',
            user_id = 'ALL',
            status = 'ALL',
            page = 1,
            limit = 20,
        } = req.query;

        // Build filter conditions
        const whereClause = buildFilterConditions({
            date_range,
            action,
            user_id,
            status,
        });

        // Calculate offset for pagination
        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Fetch audit logs with pagination
        const { count, rows } = await db.AuditLog.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: db.User,
                    as: 'user',
                    attributes: ['id', 'first_name', 'last_name', 'email'],
                    required: false,
                },
            ],
            order: [['createdAt', 'DESC']],
            limit: parseInt(limit),
            offset,
        });

        // Format response
        const formattedLogs = rows.map(log => ({
            id: log.id,
            userId: log.user_id,
            userName: log.user_name,
            action: log.action,
            resourceType: log.resource_type,
            resourceId: log.resource_id,
            resourceDisplay: formatResourceDisplay(log.resource_type, log.resource_id),
            ipAddress: log.ip_address,
            status: log.status,
            details: log.details ? JSON.parse(log.details) : null,
            timestamp: log.createdAt,
        }));

        return res.status(200).json({
            success: true,
            data: formattedLogs,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(count / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error('Error fetching audit logs:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching audit logs',
            error: error.message,
        });
    }
};

/**
 * Get audit logs statistics
 * GET /api/audit-logs/stats
 */
export const getAuditLogStats = async (req, res) => {
    try {
        const { date_range = '7d' } = req.query;

        // Build date filter
        const { startDate, endDate } = getDateRange(date_range);
        const dateFilter = {
            createdAt: {
                [Op.between]: [startDate, endDate],
            },
        };

        // Get today's date for separate query
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const todayFilter = {
            createdAt: {
                [Op.between]: [today, tomorrow],
            },
        };

        // Execute all queries in parallel
        const [totalCount, successCount, failedCount, pendingCount, todayCount] = await Promise.all([
            db.AuditLog.count({ where: dateFilter }),
            db.AuditLog.count({ where: { ...dateFilter, status: 'SUCCESS' } }),
            db.AuditLog.count({ where: { ...dateFilter, status: 'FAILED' } }),
            db.AuditLog.count({ where: { ...dateFilter, status: 'PENDING' } }),
            db.AuditLog.count({ where: todayFilter }),
        ]);

        return res.status(200).json({
            success: true,
            data: {
                total_activities: totalCount,
                successful_count: successCount,
                failed_count: failedCount,
                pending_count: pendingCount,
                today_count: todayCount,
                date_range,
            },
        });
    } catch (error) {
        console.error('Error fetching audit log stats:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching audit log statistics',
            error: error.message,
        });
    }
};

/**
 * Format resource display string
 */
const formatResourceDisplay = (resourceType, resourceId) => {
    switch (resourceType) {
        case 'CASE':
            return `Case #${resourceId}`;
        case 'INVOICE':
            return `Invoice #${resourceId}`;
        case 'USER':
            return `User #${resourceId}`;
        case 'DOCUMENT':
            return `Document #${resourceId}`;
        case 'SYSTEM':
            return 'System';
        default:
            return resourceId;
    }
};

/**
 * Export audit logs as CSV
 * GET /api/audit-logs/export
 */
export const exportAuditLogsCSV = async (req, res) => {
    try {
        const {
            date_range = '7d',
            action = 'ALL',
            user_id = 'ALL',
            status = 'ALL',
        } = req.query;

        // Build filter conditions
        const whereClause = buildFilterConditions({
            date_range,
            action,
            user_id,
            status,
        });

        // Fetch all matching audit logs (no pagination for export)
        const auditLogs = await db.AuditLog.findAll({
            where: whereClause,
            include: [
                {
                    model: db.User,
                    as: 'user',
                    attributes: ['id', 'first_name', 'last_name', 'email'],
                    required: false,
                },
            ],
            order: [['createdAt', 'DESC']],
            limit: 50000, // Safety limit for export
        });

        // Transform data for CSV
        const csvData = auditLogs.map(log => ({
            Timestamp: formatDate(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss'),
            'User Name': log.user_name,
            Action: log.action,
            Resource: formatResourceDisplay(log.resource_type, log.resource_id),
            'IP Address': log.ip_address,
            Status: log.status,
            Details: log.details || '-',
        }));

        // Set response headers for file download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="audit_logs_${formatDate(new Date(), 'yyyy-MM-dd_HH-mm-ss')}.csv"`
        );

        // Write CSV to response
        writeCsv(csvData, {
            headers: true,
        })
            .on('error', (error) => {
                console.error('Error writing CSV:', error);
                if (!res.headersSent) {
                    res.status(500).json({
                        success: false,
                        message: 'Error exporting audit logs',
                        error: error.message,
                    });
                }
            })
            .pipe(res);
    } catch (error) {
        console.error('Error exporting audit logs:', error);
        return res.status(500).json({
            success: false,
            message: 'Error exporting audit logs',
            error: error.message,
        });
    }
};

export default {
    getAuditLogs,
    getAuditLogStats,
    exportAuditLogsCSV,
};
