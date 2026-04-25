import db from '../models/index.js';

/**
 * Resource mapping based on action type
 */
const getResourceMapping = (action) => {
    const mapping = {
        'LOGIN': { resource_type: 'SYSTEM' },
        'LOGOUT': { resource_type: 'SYSTEM' },
        'CASE_CREATED': { resource_type: 'CASE' },
        'CASE_UPDATED': { resource_type: 'CASE' },
        'CASE_DELETED': { resource_type: 'CASE' },
        'PAYMENT_PROCESSED': { resource_type: 'INVOICE' },
        'PAYMENT_DELETED': { resource_type: 'INVOICE' },
        'USER_CREATED': { resource_type: 'USER' },
        'USER_UPDATED': { resource_type: 'USER' },
        'DOCUMENT_UPLOADED': { resource_type: 'DOCUMENT' },
        'DOCUMENT_DELETED': { resource_type: 'DOCUMENT' },
    };
    return mapping[action] || { resource_type: 'SYSTEM' };
};

/**
 * Extract IP address from request
 */
const getClientIP = (req) => {
    return (
        req.headers['x-forwarded-for']?.split(',')[0].trim() ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.ip ||
        'UNKNOWN'
    );
};

/**
 * Create Audit Log Entry
 * 
 * @param {Object} params - Audit log parameters
 * @param {number} params.user_id - User ID
 * @param {string} params.user_name - User name
 * @param {string} params.action - Action type (LOGIN, LOGOUT, CASE_CREATED, etc.)
 * @param {string} params.resource_id - Resource ID (case_id, invoice_number, user_id, or SYSTEM)
 * @param {string} [params.status] - Status (SUCCESS, FAILED, PENDING)
 * @param {string} [params.details] - Additional details as JSON string
 * @param {Object} [params.req] - Express request object for IP and user-agent extraction
 * @param {string} [params.resource_type] - Resource type (overrides auto-mapping)
 * @returns {Promise<Object>} Created audit log entry
 */
export const createAuditLog = async (params) => {
    try {
        const {
            user_id,
            user_name,
            action,
            resource_id,
            status = 'SUCCESS',
            details,
            req,
            resource_type,
        } = params;

        // Auto-determine resource_type if not provided
        const mapping = getResourceMapping(action);
        const finalResourceType = resource_type || mapping.resource_type;

        // Extract IP and user-agent from request if available
        const ip_address = req ? getClientIP(req) : 'UNKNOWN';
        const user_agent = req?.headers['user-agent'] || null;

        // Create audit log entry
        const auditLog = await db.AuditLog.create({
            user_id: user_id || null,
            user_name: user_name || 'SYSTEM',
            action,
            resource_type: finalResourceType,
            resource_id: resource_id || 'SYSTEM',
            ip_address,
            user_agent,
            status,
            details: details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
        });

        console.log(`[AUDIT] ${action} by ${user_name} - Resource: ${finalResourceType}#${resource_id}`);

        return auditLog;
    } catch (error) {
        // Ensure audit logging failures don't break main API
        console.error('[AUDIT_LOG_ERROR]', error.message);
        return null;
    }
};

/**
 * Batch create audit logs
 */
export const createBatchAuditLogs = async (auditEntries) => {
    try {
        const logs = await db.AuditLog.bulkCreate(
            auditEntries.map(entry => ({
                user_id: entry.user_id || null,
                user_name: entry.user_name || 'SYSTEM',
                action: entry.action,
                resource_type: getResourceMapping(entry.action).resource_type,
                resource_id: entry.resource_id || 'SYSTEM',
                ip_address: entry.ip_address || 'UNKNOWN',
                user_agent: entry.user_agent || null,
                status: entry.status || 'SUCCESS',
                details: entry.details ? JSON.stringify(entry.details) : null,
            }))
        );
        return logs;
    } catch (error) {
        console.error('[AUDIT_BATCH_LOG_ERROR]', error.message);
        return [];
    }
};

export default { createAuditLog, createBatchAuditLogs };
