import logger from "../../../utils/logger.js";
import ApiResponse from "../../../utils/apiResponse.js";
import {
  generateCredentials,
  resendCredentials,
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
