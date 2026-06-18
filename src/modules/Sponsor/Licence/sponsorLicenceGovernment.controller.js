import logger from "../../../utils/logger.js";
import ApiResponse from "../../../utils/apiResponse.js";
import { confirmCredentialsReceived, decryptCredentialPassword } from "../../../services/licenceGovernment.service.js";

export const getGovernmentCredentials = async (req, res) => {
  try {
    const application = await req.tenantDb.LicenceApplication.findOne({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!application) return ApiResponse.notFound(res, "Licence application not found");

    const tracking = await req.tenantDb.LicenceGovernmentTracking.findOne({
      where: { licenceApplicationId: application.id },
    });

    if (!tracking?.ukviPortalUserId || !tracking?.credentialsSentAt) {
      return ApiResponse.notFound(res, "UKVI portal credentials have not been released yet");
    }

    let ukviPortalPassword = null;
    try {
      ukviPortalPassword = decryptCredentialPassword(tracking.ukviPortalPasswordEncrypted);
    } catch (err) {
      logger.error({ err }, "getGovernmentCredentials: decryption failed");
      return ApiResponse.error(res, "Failed to retrieve credentials", 500);
    }

    return ApiResponse.success(res, "UKVI portal credentials retrieved", {
      ukviPortalUserId: tracking.ukviPortalUserId,
      ukviPortalPassword,
      credentialsSentAt: tracking.credentialsSentAt,
      credentialsConfirmedAt: tracking.ukviCredentialsSubmittedAt || null,
    });
  } catch (err) {
    logger.error({ err }, "getGovernmentCredentials failed");
    return ApiResponse.error(res, "Failed to retrieve credentials", 500, err);
  }
};

export const confirmGovernmentCredentialsReceived = async (req, res) => {
  try {
    // Ownership check: sponsor may only act on their own applications.
    const application = await req.tenantDb.LicenceApplication.findOne({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!application) return ApiResponse.notFound(res, "Licence application not found");

    const data = await confirmCredentialsReceived(req.tenantDb, application, req.user, req);
    return ApiResponse.success(res, "Credentials receipt confirmed", data);
  } catch (err) {
    if (err.statusCode === 400) return ApiResponse.badRequest(res, err.message);
    if (err.statusCode === 404) return ApiResponse.notFound(res, err.message);
    logger.error({ err }, "confirmGovernmentCredentialsReceived failed");
    return ApiResponse.error(res, "Failed to confirm credentials receipt", 500, err);
  }
};
