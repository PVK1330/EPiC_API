/**
 * GDPR Compliance — Superadmin panel.
 *
 * Endpoints:
 *   GET    /api/superadmin/gdpr/:orgId/export      — Subject Access Request / Article 20 data export
 *   DELETE /api/superadmin/gdpr/:orgId             — GDPR erasure on account closure
 *   GET    /api/superadmin/gdpr/retention-report   — Records past retention deadline (all orgs or one)
 *   GET    /api/superadmin/gdpr/:orgId/retention-report — Per-org retention report
 */
import catchAsync from '../../../utils/catchAsync.js';
import ApiResponse from '../../../utils/apiResponse.js';
import {
  exportTenantData,
  deleteTenantData,
  getRetentionReport,
} from '../../../services/gdpr.service.js';

/**
 * GET /api/superadmin/gdpr/:orgId/export
 * Download all personal data for an organisation as a JSON attachment.
 * Covers Article 15 (access) and Article 20 (portability) obligations.
 */
export const exportOrgData = catchAsync(async (req, res) => {
  const { orgId } = req.params;
  const exportData = await exportTenantData(Number(orgId));

  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="gdpr-export-org-${orgId}-${Date.now()}.json"`,
  );
  return res.json(exportData);
});

/**
 * DELETE /api/superadmin/gdpr/:orgId
 * GDPR erasure: anonymise all PII across users, candidateApplications,
 * sponsoredWorkers, and licenceAuthorisingOfficers, then suspend the org.
 */
export const deleteOrgData = catchAsync(async (req, res) => {
  const { orgId } = req.params;
  const { hardDelete = false, reason } = req.body;

  const results = await deleteTenantData(Number(orgId), { hardDelete, reason });
  return ApiResponse.success(res, results, 'Tenant data deleted successfully (GDPR erasure)');
});

/**
 * GET /api/superadmin/gdpr/retention-report
 * Platform-wide retention report: lists records past the retention deadline
 * across all suspended organisations.
 *
 * Query param: ?orgId=<id> narrows scope to a single organisation.
 */
export const getOrgRetentionReport = catchAsync(async (req, res) => {
  const orgId = req.query.orgId ? Number(req.query.orgId) : null;
  const report = await getRetentionReport(orgId);
  return ApiResponse.success(res, report, 'Retention report generated');
});

/**
 * GET /api/superadmin/gdpr/:orgId/retention-report
 * Per-organisation retention report (convenience alias with orgId as path param).
 */
export const getOrgRetentionReportById = catchAsync(async (req, res) => {
  const { orgId } = req.params;
  const report = await getRetentionReport(Number(orgId));
  return ApiResponse.success(res, report, 'Retention report generated');
});
