import { Router } from 'express';
import {
  exportOrgData,
  deleteOrgData,
  getOrgRetentionReport,
  getOrgRetentionReportById,
} from './gdpr.controller.js';

const router = Router();

/**
 * GET  /api/superadmin/gdpr/retention-report
 * Platform-wide retention report. Optional ?orgId=<id> to narrow scope.
 * IMPORTANT: this route must be declared BEFORE /:orgId routes to avoid
 * Express interpreting "retention-report" as an orgId param.
 */
router.get('/retention-report', getOrgRetentionReport);

/**
 * GET  /api/superadmin/gdpr/:orgId/export
 * Subject Access Request / Article 20 data export for one organisation.
 */
router.get('/:orgId/export', exportOrgData);

/**
 * GET  /api/superadmin/gdpr/:orgId/retention-report
 * Per-organisation retention report.
 */
router.get('/:orgId/retention-report', getOrgRetentionReportById);

/**
 * DELETE /api/superadmin/gdpr/:orgId
 * GDPR erasure: anonymise all PII and suspend the organisation.
 */
router.delete('/:orgId', deleteOrgData);

export default router;
