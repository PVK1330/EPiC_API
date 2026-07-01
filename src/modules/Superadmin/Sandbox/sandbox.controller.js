/**
 * Week 8: Sandbox/demo environment management (Superadmin).
 */
import catchAsync from '../../../utils/catchAsync.js';
import ApiResponse from '../../../utils/apiResponse.js';
import platformDb from '../../../models/index.js';
import { createSandboxOrganisation, resetSandboxEnvironments } from '../../../services/sandbox.service.js';

/** GET /api/superadmin/sandbox — list all sandbox orgs */
export const listSandboxOrgs = catchAsync(async (req, res) => {
  const orgs = await platformDb.Organisation.findAll({
    where: { is_sandbox: true },
    attributes: ['id', 'name', 'slug', 'status', 'primaryEmail', 'createdAt'],
    order: [['createdAt', 'DESC']],
  });
  return ApiResponse.success(res, orgs);
});

/** POST /api/superadmin/sandbox — create a new sandbox org */
export const createSandbox = catchAsync(async (req, res) => {
  const { name, adminEmail } = req.body;
  const result = await createSandboxOrganisation({ name, adminEmail });
  return ApiResponse.created(res, result, 'Sandbox organisation created with demo data');
});

/** POST /api/superadmin/sandbox/reset — manually trigger reset of all sandbox orgs */
export const triggerSandboxReset = catchAsync(async (req, res) => {
  const results = await resetSandboxEnvironments();
  return ApiResponse.success(res, results, 'Sandbox environments reset');
});

/** DELETE /api/superadmin/sandbox/:id — delete a sandbox org */
export const deleteSandbox = catchAsync(async (req, res) => {
  const { id } = req.params;
  const org = await platformDb.Organisation.findOne({ where: { id, is_sandbox: true } });
  if (!org) return ApiResponse.notFound(res, 'Sandbox organisation not found');
  await org.destroy();
  return ApiResponse.success(res, { id }, 'Sandbox organisation deleted');
});
