import logger from "../../../utils/logger.js";
import ApiResponse from "../../../utils/apiResponse.js";
import { confirmCredentialsReceived } from "../../../services/licenceGovernment.service.js";

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
