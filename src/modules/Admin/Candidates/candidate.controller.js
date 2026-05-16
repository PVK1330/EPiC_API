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
  });
  
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
