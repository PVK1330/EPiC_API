import { CandidateService } from './candidate.service.js';
import ApiResponse from '../../../utils/apiResponse.js';
import catchAsync from '../../../utils/catchAsync.js';
import logger from '../../../utils/logger.js';
import { getVisaExpiryAlertDays } from '../../../services/visaExpiry.service.js';

/**
 * Handles incoming HTTP requests for Candidate management.
 * Uses CandidateService for business logic.
 */

// Create Candidate
export const createCandidate = catchAsync(async (req, res) => {
  logger.info({
    route: req.originalUrl,
    method: req.method,
    stage: 'candidate.controller.createCandidate',
    bodyKeys: Object.keys(req.body || {}),
    validatedBodyKeys: Object.keys(req.validated?.body || {}),
    schema: 'createCandidateSchema',
  });
  const service = new CandidateService(req.tenantDb);
  const result = await service.createCandidate({
    ...req.validated.body,
    organisation_id: req.user.organisation_id
  }, { tenantDb: req.tenantDb, io: req.app.get('io'), organisationId: req.user.organisation_id }, req.user);
  
  return ApiResponse.created(res, "Candidate created successfully", result);
});

// Send Credentials to Client
export const sendCredentialsToClient = catchAsync(async (req, res) => {
  logger.info({
    route: req.originalUrl,
    method: req.method,
    stage: 'candidate.controller.sendCredentialsToClient',
    schema: 'sendCredentialsToClientSchema',
  });
  const service = new CandidateService(req.tenantDb);
  const result = await service.sendCredentialsToClient(
    req.validated.body,
    {
      tenantDb: req.tenantDb,
      io: req.app?.get?.('io'),
      organisationId: req.user.organisation_id,
      req,
    },
    req.user,
  );

  const message = result.emailSent
    ? "Client account created successfully and login credentials have been sent to the client’s email address."
    : "Client account created successfully, but credential email delivery failed.";

  return ApiResponse.created(res, message, {
    candidateId: result.candidateId,
    emailSent: result.emailSent,
  });
});


// Get All Candidates
export const getAllCandidates = catchAsync(async (req, res) => {
  const service = new CandidateService(req.tenantDb);
  const result = await service.getAllCandidates(req.query, req.user?.organisation_id);
  
  return ApiResponse.success(res, "Candidates retrieved successfully", result);
});

// Get Visa Expiry Alerts Count
export const getVisaExpiryAlertsCount = catchAsync(async (req, res) => {
  const service = new CandidateService(req.tenantDb);
  // Phase 2 UAT 3.1: default to the firm's alert window (sla_settings), not 30.
  const windowDays = parseInt(req.query?.windowDays, 10) || (await getVisaExpiryAlertDays(req.tenantDb));
  const stats = await service.getVisaExpiryAlertStats({
    organisationId: req.user?.organisation_id,
    windowDays,
  });
  
  return ApiResponse.success(res, "Visa expiry alerts count retrieved successfully", {
    visaExpiryAlerts: { count: stats.upcoming, expiredCount: stats.expired, total: stats.total, windowDays },
    count: stats.upcoming,
    expiredCount: stats.expired,
    visaExpiryAlertsCount: stats.upcoming,
    visaExpiredAlertsCount: stats.expired,
    windowDays,
  });
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

// ── Visa Refusal Handlers (Staff / Admin) ───────────────────────────────────

export const getCandidateVisaRefusals = catchAsync(async (req, res) => {
  const candidateId = Number(req.params.id);
  const application = await req.tenantDb.CandidateApplication.findOne({ where: { userId: candidateId } });
  if (!application) {
    return ApiResponse.success(res, "Visa refusals retrieved successfully", { visaRefusals: [] });
  }

  let refusals = await req.tenantDb.CandidateVisaRefusal.findAll({
    where: { applicationId: application.id },
    order: [['refusalDate', 'ASC'], ['id', 'ASC']],
  });

  if (refusals.length === 0 && application.refusedVisa === 'Yes' && application.refusedVisaDate) {
    refusals = [
      {
        id: null,
        applicationId: application.id,
        userId: candidateId,
        refusalDate: application.refusedVisaDate,
        country: application.refusedVisaCountry || 'Unknown',
        visaType: application.refusedVisaType || 'Other',
        reason: application.refusedVisaReason || application.refusedVisaDetails || 'Previous visa refusal',
        referenceNumber: application.refusedVisaReference || null,
        details: application.refusedVisaDetails || null,
      },
    ];
  }

  return ApiResponse.success(res, "Visa refusals retrieved successfully", { visaRefusals: refusals });
});

export const createCandidateVisaRefusal = catchAsync(async (req, res) => {
  const candidateId = Number(req.params.id);
  const candidate = await req.tenantDb.User.findOne({ where: { id: candidateId, role_id: 1 } });
  if (!candidate) return ApiResponse.notFound(res, 'Candidate not found');

  let application = await req.tenantDb.CandidateApplication.findOne({ where: { userId: candidateId } });
  if (!application) {
    application = await req.tenantDb.CandidateApplication.create({
      userId: candidateId,
      status: 'draft',
      organisation_id: candidate.organisation_id || req.user.organisation_id,
    });
  }

  const { validateVisaRefusal } = await import('../../../services/visaRefusal.service.js');
  const validated = validateVisaRefusal(req.body);

  const refusal = await req.tenantDb.sequelize.transaction(async (t) => {
    const created = await req.tenantDb.CandidateVisaRefusal.create({
      ...validated,
      applicationId: application.id,
      userId: candidateId,
      organisationId: candidate.organisation_id || req.user.organisation_id || null,
    }, { transaction: t });

    await application.update({
      refusedVisa: 'Yes',
      refusedVisaDate: created.refusalDate,
      refusedVisaCountry: created.country,
      refusedVisaType: created.visaType,
      refusedVisaReason: created.reason,
      refusedVisaDetails: created.details || created.reason,
      refusedVisaReference: created.referenceNumber || null,
    }, { transaction: t, hooks: false });

    return created;
  });

  const allRefusals = await req.tenantDb.CandidateVisaRefusal.findAll({
    where: { applicationId: application.id },
    order: [['refusalDate', 'ASC'], ['id', 'ASC']],
  });

  return ApiResponse.created(res, "Visa refusal created successfully", {
    refusal,
    visaRefusals: allRefusals,
  });
});

export const updateCandidateVisaRefusal = catchAsync(async (req, res) => {
  const candidateId = Number(req.params.id);
  const refusalId = Number(req.params.refusalId);

  // Client isolation: only find refusal belonging to this candidate
  const refusal = await req.tenantDb.CandidateVisaRefusal.findOne({
    where: { id: refusalId, userId: candidateId },
  });
  if (!refusal) return ApiResponse.notFound(res, 'Visa refusal not found');

  const { validateVisaRefusal } = await import('../../../services/visaRefusal.service.js');
  const validated = validateVisaRefusal(req.body);

  await req.tenantDb.sequelize.transaction(async (t) => {
    await refusal.update(validated, { transaction: t });

    const all = await req.tenantDb.CandidateVisaRefusal.findAll({
      where: { applicationId: refusal.applicationId },
      order: [['refusalDate', 'ASC'], ['id', 'ASC']],
      transaction: t,
    });

    const application = await req.tenantDb.CandidateApplication.findByPk(refusal.applicationId, { transaction: t });
    if (application && all.length > 0) {
      const first = all[0];
      await application.update({
        refusedVisa: 'Yes',
        refusedVisaDate: first.refusalDate,
        refusedVisaCountry: first.country,
        refusedVisaType: first.visaType,
        refusedVisaReason: first.reason,
        refusedVisaDetails: first.details || first.reason,
        refusedVisaReference: first.referenceNumber || null,
      }, { transaction: t, hooks: false });
    }
  });

  const allRefusals = await req.tenantDb.CandidateVisaRefusal.findAll({
    where: { applicationId: refusal.applicationId },
    order: [['refusalDate', 'ASC'], ['id', 'ASC']],
  });

  return ApiResponse.success(res, "Visa refusal updated successfully", {
    refusal,
    visaRefusals: allRefusals,
  });
});

export const deleteCandidateVisaRefusal = catchAsync(async (req, res) => {
  const candidateId = Number(req.params.id);
  const refusalId = Number(req.params.refusalId);

  // Client isolation: only find refusal belonging to this candidate
  const refusal = await req.tenantDb.CandidateVisaRefusal.findOne({
    where: { id: refusalId, userId: candidateId },
  });
  if (!refusal) return ApiResponse.notFound(res, 'Visa refusal not found');

  const applicationId = refusal.applicationId;

  await req.tenantDb.sequelize.transaction(async (t) => {
    await refusal.destroy({ transaction: t });

    const remaining = await req.tenantDb.CandidateVisaRefusal.findAll({
      where: { applicationId },
      order: [['refusalDate', 'ASC'], ['id', 'ASC']],
      transaction: t,
    });

    const application = await req.tenantDb.CandidateApplication.findByPk(applicationId, { transaction: t });
    if (application) {
      if (remaining.length > 0) {
        const first = remaining[0];
        await application.update({
          refusedVisa: 'Yes',
          refusedVisaDate: first.refusalDate,
          refusedVisaCountry: first.country,
          refusedVisaType: first.visaType,
          refusedVisaReason: first.reason,
          refusedVisaDetails: first.details || first.reason,
          refusedVisaReference: first.referenceNumber || null,
        }, { transaction: t, hooks: false });
      } else {
        await application.update({
          refusedVisa: 'No',
          refusedVisaDate: null,
          refusedVisaCountry: null,
          refusedVisaType: null,
          refusedVisaReason: null,
          refusedVisaDetails: null,
          refusedVisaReference: null,
        }, { transaction: t, hooks: false });
      }
    }
  });

  const remainingRefusals = await req.tenantDb.CandidateVisaRefusal.findAll({
    where: { applicationId },
    order: [['refusalDate', 'ASC'], ['id', 'ASC']],
  });

  return ApiResponse.success(res, "Visa refusal deleted successfully", {
    visaRefusals: remainingRefusals,
  });
});
