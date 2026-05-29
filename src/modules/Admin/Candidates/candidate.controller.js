import { CandidateService } from './candidate.service.js';
import ApiResponse from '../../../utils/apiResponse.js';
import catchAsync from '../../../utils/catchAsync.js';

/**
 * Handles incoming HTTP requests for Candidate management.
 * Uses CandidateService for business logic.
 */

// Create Candidate
export const createCandidate = catchAsync(async (req, res) => {
  const service = new CandidateService(req.tenantDb);
  const result = await service.createCandidate({
    ...req.body,
    organisation_id: req.user.organisation_id
  }, { tenantDb: req.tenantDb, io: req.app.get('io'), organisationId: req.user.organisation_id }, req.user);
  
  return ApiResponse.created(res, "Candidate created successfully", result);
});

// Get All Candidates
export const getAllCandidates = catchAsync(async (req, res) => {
  const service = new CandidateService(req.tenantDb);
  const result = await service.getAllCandidates(req.query);
  
  return ApiResponse.success(res, "Candidates retrieved successfully", result);
});

// Get Candidate by ID
export const getCandidateById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const service = new CandidateService(req.tenantDb);
  const candidate = await service.getCandidateById(id);
  
  return ApiResponse.success(res, "Candidate retrieved successfully", { candidate });
});

// Update Candidate
export const updateCandidate = catchAsync(async (req, res) => {
  const { id } = req.params;
  const service = new CandidateService(req.tenantDb);
  const candidate = await service.updateCandidate(id, req.body);
  
  return ApiResponse.success(res, "Candidate updated successfully", { candidate });
});

// Delete Candidate
export const deleteCandidate = catchAsync(async (req, res) => {
  const { id } = req.params;
  const service = new CandidateService(req.tenantDb);
  await service.deleteCandidate(id);
  
  return ApiResponse.success(res, "Candidate deleted successfully");
});

// Reset Password
export const resetCandidatePassword = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { new_password, confirm_password } = req.body;
  
  if (new_password !== confirm_password) {
    return ApiResponse.badRequest(res, "Passwords do not match");
  }

  const service = new CandidateService(req.tenantDb);
  await service.updateCandidate(id, { password: new_password }); // Simple reuse of update for now or add specific method
  
  return ApiResponse.success(res, "Password reset successfully");
});

// Get Candidate Application
export const getCandidateApplication = catchAsync(async (req, res) => {
  const { id } = req.params;
  const service = new CandidateService(req.tenantDb);
  const application = await service.getCandidateApplication(id);
  
  return ApiResponse.success(res, "Candidate application retrieved successfully", { application });
});

// Update Candidate Application
export const updateCandidateApplication = catchAsync(async (req, res) => {
  const { id } = req.params;
  const service = new CandidateService(req.tenantDb);
  const context = { tenantDb: req.tenantDb, io: req.app.get('io'), organisationId: req.user.organisation_id };
  const candidate = await service.updateCandidateApplication(id, req.body, req.user, context);

  return ApiResponse.success(res, "Client updated successfully", {
    candidate,
    application: candidate?.application ?? null,
  });
});

// Toggle Candidate Status (active ↔ inactive)
export const toggleCandidateStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const candidate = await req.tenantDb.User.findOne({ where: { id, role_id: 1 } });
  if (!candidate) return ApiResponse.notFound(res, 'Candidate not found');
  const newStatus = candidate.status === 'active' ? 'inactive' : 'active';
  await candidate.update({ status: newStatus });
  return ApiResponse.success(res, `Status updated to ${newStatus}`, { status: newStatus });
});
