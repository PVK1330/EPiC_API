import logger from "../../../utils/logger.js";
import ApiResponse from "../../../utils/apiResponse.js";
import {
  generateCredentials,
  resendCredentials,
  getSubmittedCredentials,
  requestCredentialResubmission,
  verifySubmittedCredentials,
} from "../../../services/licenceGovernment.service.js";

const loadApplication = async (tenantDb, id) => {
  const application = await tenantDb.LicenceApplication.findByPk(id);
  return application;
};

export const generateLicenceCredentials = async (req, res) => {
  try {
    const application = await loadApplication(req.tenantDb, req.params.id);
    if (!application) return ApiResponse.notFound(res, "Licence application not found");

    const data = await generateCredentials(
      req.tenantDb,
      application,
      req.user,
      req.validated.body,
      req
    );
    return ApiResponse.success(res, "UKVI portal credentials generated", data);
  } catch (err) {
    if (err.statusCode === 400) return ApiResponse.badRequest(res, err.message);
    logger.error({ err }, "generateLicenceCredentials failed");
    return ApiResponse.error(res, "Failed to generate credentials", 500, err);
  }
};

export const resendLicenceCredentials = async (req, res) => {
  try {
    const application = await loadApplication(req.tenantDb, req.params.id);
    if (!application) return ApiResponse.notFound(res, "Licence application not found");

    const data = await resendCredentials(req.tenantDb, application, req.user, req);
    return ApiResponse.success(res, "Credentials resent to sponsor", data);
  } catch (err) {
    if (err.statusCode === 400) return ApiResponse.badRequest(res, err.message);
    logger.error({ err }, "resendLicenceCredentials failed");
    return ApiResponse.error(res, "Failed to resend credentials", 500, err);
  }
};

export const getAdminSubmittedCredentials = async (req, res) => {
  try {
    const data = await getSubmittedCredentials(req.tenantDb, req.params.id);
    if (!data) return ApiResponse.notFound(res, "No credentials submitted by sponsor yet");
    return ApiResponse.success(res, "Submitted credentials retrieved", data);
  } catch (err) {
    logger.error({ err }, "getAdminSubmittedCredentials failed");
    return ApiResponse.error(res, "Failed to retrieve submitted credentials", 500, err);
  }
};

export const verifyAdminCredentials = async (req, res) => {
  try {
    const application = await loadApplication(req.tenantDb, req.params.id);
    if (!application) return ApiResponse.notFound(res, "Licence application not found");
    const data = await verifySubmittedCredentials(req.tenantDb, application, "admin", req.user, req);
    return ApiResponse.success(res, "Credentials verified", data);
  } catch (err) {
    if (err.statusCode === 400) return ApiResponse.badRequest(res, err.message);
    logger.error({ err }, "verifyAdminCredentials failed");
    return ApiResponse.error(res, "Failed to verify credentials", 500, err);
  }
};

export const requestAdminCredentialResubmission = async (req, res) => {
  try {
    const application = await loadApplication(req.tenantDb, req.params.id);
    if (!application) return ApiResponse.notFound(res, "Licence application not found");
    const data = await requestCredentialResubmission(req.tenantDb, application, req.user, req);
    return ApiResponse.success(res, "Resubmission request sent to sponsor", data);
  } catch (err) {
    logger.error({ err }, "requestAdminCredentialResubmission failed");
    return ApiResponse.error(res, "Failed to request credential resubmission", 500, err);
  }
};
