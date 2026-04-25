import express from 'express';
import {
    getAuditLogs,
    getAuditLogStats,
    exportAuditLogsCSV,
} from '../controllers/auditLog.controller.js';

const router = express.Router();

/**
 * @route   GET /api/audit-logs
 * @desc    Get filtered audit logs with pagination
 * @query   {string} date_range - 7d, 30d, 3m, 1y
 * @query   {string} action - ALL, LOGIN, LOGOUT, CASE_CREATED, etc.
 * @query   {string} user_id - user ID or ALL
 * @query   {string} status - ALL, SUCCESS, FAILED, PENDING
 * @query   {number} page - pagination page (default: 1)
 * @query   {number} limit - items per page (default: 20)
 * @access  Private
 */
router.get('/', getAuditLogs);

/**
 * @route   GET /api/audit-logs/stats
 * @desc    Get audit log statistics
 * @query   {string} date_range - 7d, 30d, 3m, 1y
 * @access  Private
 */
router.get('/stats', getAuditLogStats);

/**
 * @route   GET /api/audit-logs/export
 * @desc    Export audit logs as CSV
 * @query   {string} date_range - 7d, 30d, 3m, 1y
 * @query   {string} action - ALL, LOGIN, LOGOUT, CASE_CREATED, etc.
 * @query   {string} user_id - user ID or ALL
 * @query   {string} status - ALL, SUCCESS, FAILED, PENDING
 * @access  Private
 */
router.get('/export', exportAuditLogsCSV);

export default router;
