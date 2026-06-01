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
    ...req.validated.body,
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
  const { id } = req.validated.params;
  const service = new CandidateService(req.tenantDb);
  const candidate = await service.getCandidateById(id);
  
  return ApiResponse.success(res, "Candidate retrieved successfully", { candidate });
});

// Update Candidate
export const updateCandidate = catchAsync(async (req, res) => {
  const { id } = req.validated.params;
  const service = new CandidateService(req.tenantDb);
  const candidate = await service.updateCandidate(id, req.validated.body);
  
  return ApiResponse.success(res, "Candidate updated successfully", { candidate });
});

// Delete Candidate
export const deleteCandidate = catchAsync(async (req, res) => {
  const { id } = req.params;
  const service = new CandidateService(req.tenantDb);
  await service.deleteCandidate(id);
  
  return ApiResponse.success(res, "Candidate deleted successfully");
});

// Reset Password — strength + match are enforced by resetCandidatePasswordSchema.
export const resetCandidatePassword = catchAsync(async (req, res) => {
  const { id } = req.validated.params;
  const { new_password } = req.validated.body;

  const service = new CandidateService(req.tenantDb);
  await service.resetCandidatePassword(id, new_password);

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

// Assign (or unassign) a candidate to a business/sponsor
export const assignCandidateBusiness = catchAsync(async (req, res) => {
  const { id } = req.validated.params;
  const { businessId } = req.validated.body;
  const service = new CandidateService(req.tenantDb);
  const result = await service.assignBusiness(id, businessId, {
    organisationId: req.user.organisation_id,
  });

  return ApiResponse.success(
    res,
    businessId == null ? 'Candidate unassigned from business' : 'Candidate assigned to business',
    result,
  );
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
