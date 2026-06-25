import logger from "../../utils/logger.js";
import ApiResponse from "../../utils/apiResponse.js";
import {
  startReview,
  startGovernmentRegistration,
  completeGovernmentRegistration,
  requestGovernmentCredentials,
  recordGovernmentSubmission,
  confirmHomeOfficeDispatch,
  getSubmittedCredentials,
  requestCredentialResubmission,
  verifySubmittedCredentials,
} from "../../services/licenceGovernment.service.js";

// All handlers rely on req.licenceApplication populated by ensureAssignedCaseworker().

export const startLicenceReview = async (req, res) => {
  try {
    const data = await startReview(req.tenantDb, req.licenceApplication, req.user, req);
    return ApiResponse.success(res, "Licence review started", data);
  } catch (err) {
    if (err.statusCode === 400) return ApiResponse.badRequest(res, err.message);
    logger.error({ err }, "startLicenceReview failed");
    return ApiResponse.error(res, "Failed to start licence review", 500, err);
  }
};

export const startLicenceGovernmentRegistration = async (req, res) => {
  try {
    const data = await startGovernmentRegistration(req.tenantDb, req.licenceApplication, req.user, req);
    return ApiResponse.success(res, "Government registration started", data);
  } catch (err) {
    if (err.statusCode === 400) return ApiResponse.badRequest(res, err.message);
    logger.error({ err }, "startLicenceGovernmentRegistration failed");
    return ApiResponse.error(res, "Failed to start government registration", 500, err);
  }
};

export const completeLicenceGovernmentRegistration = async (req, res) => {
  try {
    const data = await completeGovernmentRegistration(
      req.tenantDb,
      req.licenceApplication,
      req.user,
      req.validated.body,
      req
    );
    return ApiResponse.success(res, "Government registration completed", data);
  } catch (err) {
    if (err.statusCode === 400) return ApiResponse.badRequest(res, err.message);
    logger.error({ err }, "completeLicenceGovernmentRegistration failed");
    return ApiResponse.error(res, "Failed to complete government registration", 500, err);
  }
};

export const requestLicenceGovernmentCredentials = async (req, res) => {
  try {
    const data = await requestGovernmentCredentials(req.tenantDb, req.licenceApplication, req.user, req);
    return ApiResponse.success(res, "Prompt sent to sponsor to submit UKVI credentials", data);
  } catch (err) {
    if (err.statusCode === 400) return ApiResponse.badRequest(res, err.message);
    logger.error({ err }, "requestLicenceGovernmentCredentials failed");
    return ApiResponse.error(res, "Failed to send credentials prompt", 500, err);
  }
};

export const recordLicenceGovernmentSubmission = async (req, res) => {
  try {
    const data = await recordGovernmentSubmission(
      req.tenantDb,
      req.licenceApplication,
      req.user,
      req.validated.body,
      req
    );
    return ApiResponse.success(res, "Government submission recorded", data);
  } catch (err) {
    if (err.statusCode === 400) return ApiResponse.badRequest(res, err.message);
    logger.error({ err }, "recordLicenceGovernmentSubmission failed");
    return ApiResponse.error(res, "Failed to record government submission", 500, err);
  }
};

// GET /:id/submitted-credentials
// Returns the decrypted UKVI credentials the sponsor submitted.
export const getSubmittedLicenceCredentials = async (req, res) => {
  try {
    const data = await getSubmittedCredentials(req.tenantDb, req.licenceApplication.id);
    if (!data) return ApiResponse.notFound(res, "No credentials submitted by sponsor yet");
    return ApiResponse.success(res, "Submitted credentials retrieved", data);
  } catch (err) {
    logger.error({ err }, "getSubmittedLicenceCredentials failed");
    return ApiResponse.error(res, "Failed to retrieve submitted credentials", 500, err);
  }
};

// POST /:id/verify-credentials
// Caseworker marks submitted credentials as verified (completes their stage task).
export const verifyLicenceCredentials = async (req, res) => {
  try {
    const data = await verifySubmittedCredentials(req.tenantDb, req.licenceApplication, "caseworker", req.user, req);
    return ApiResponse.success(res, "Credentials verified", data);
  } catch (err) {
    if (err.statusCode === 400) return ApiResponse.badRequest(res, err.message);
    logger.error({ err }, "verifyLicenceCredentials failed");
    return ApiResponse.error(res, "Failed to verify credentials", 500, err);
  }
};

// POST /:id/request-credentials-resubmission
// Caseworker requests sponsor to resubmit UKVI credentials.
export const requestCredentialsResubmission = async (req, res) => {
  try {
    const data = await requestCredentialResubmission(req.tenantDb, req.licenceApplication, req.user, req);
    return ApiResponse.success(res, "Resubmission request sent to sponsor", data);
  } catch (err) {
    logger.error({ err }, "requestCredentialsResubmission failed");
    return ApiResponse.error(res, "Failed to request credential resubmission", 500, err);
  }
};

// POST /:id/home-office-dispatch
// Caseworker confirms physical supporting documents dispatched to the Home Office.
export const recordHomeOfficeDispatch = async (req, res) => {
  try {
    const data = await confirmHomeOfficeDispatch(
      req.tenantDb,
      req.licenceApplication,
      req.user,
      req.validated?.body ?? req.body,
      req
    );
    return ApiResponse.success(res, "Home Office document dispatch recorded", data);
  } catch (err) {
    if (err.statusCode === 400) return ApiResponse.badRequest(res, err.message);
    logger.error({ err }, "recordHomeOfficeDispatch failed");
    return ApiResponse.error(res, "Failed to record Home Office dispatch", 500, err);
  }
};
