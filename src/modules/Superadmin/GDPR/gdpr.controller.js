/**
 * Week 8: GDPR compliance — Superadmin panel.
 */
import catchAsync from '../../../utils/catchAsync.js';
import ApiResponse from '../../../utils/apiResponse.js';
import { exportTenantData, deleteTenantData } from '../../../services/gdpr.service.js';

/** GET /api/superadmin/gdpr/:orgId/export — download org data as JSON */
export const exportOrgData = catchAsync(async (req, res) => {
  const { orgId } = req.params;
  const exportData = await exportTenantData(Number(orgId));

  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="gdpr-export-org-${orgId}-${Date.now()}.json"`
  );
  return res.json(exportData);
});

/** DELETE /api/superadmin/gdpr/:orgId — GDPR erasure on account closure */
export const deleteOrgData = catchAsync(async (req, res) => {
  const { orgId } = req.params;
  const { hardDelete = false, reason } = req.body;

  const results = await deleteTenantData(Number(orgId), { hardDelete, reason });
  return ApiResponse.success(res, results, 'Tenant data deleted successfully (GDPR erasure)');
});
