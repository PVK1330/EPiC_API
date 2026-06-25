import logger from "../../../utils/logger.js";
import ApiResponse from "../../../utils/apiResponse.js";
import {
  confirmCredentialsReceived,
  decryptCredentialPassword,
  submitUkviCredentials,
  confirmUkviPayment,
} from "../../../services/licenceGovernment.service.js";

const ownedApp = (req) =>
  req.tenantDb.LicenceApplication.findOne({
    where: { id: req.params.id, userId: req.user.userId },
  });

// GET /:id/government-credentials
// Returns credentials that the sponsor themselves submitted (flow v2).
export const getGovernmentCredentials = async (req, res) => {
  try {
    const application = await ownedApp(req);
    if (!application) return ApiResponse.notFound(res, "Licence application not found");

    const tracking = await req.tenantDb.LicenceGovernmentTracking.findOne({
      where: { licenceApplicationId: application.id },
    });

    if (!tracking?.ukviPortalUserId) {
      return ApiResponse.notFound(res, "No UKVI portal credentials have been submitted yet");
    }

    let ukviPortalPassword = null;
    try {
      if (tracking.ukviPortalPasswordEncrypted) {
        ukviPortalPassword = decryptCredentialPassword(tracking.ukviPortalPasswordEncrypted);
      }
    } catch (err) {
      logger.error({ err }, "getGovernmentCredentials: decryption failed");
      return ApiResponse.error(res, "Failed to retrieve credentials", 500);
    }

    return ApiResponse.success(res, "UKVI portal credentials retrieved", {
      ukviPortalUserId:          tracking.ukviPortalUserId,
      ukviPortalPassword,
      smsPortalUsername:         tracking.smsPortalUsername || null,
      credentialsSentAt:         tracking.credentialsSentAt,
      ukviCredentialsSubmittedAt: tracking.ukviCredentialsSubmittedAt || null,
      homeOfficeDocDeadline:     tracking.homeOfficeDocDeadline || null,
      homeOfficeDocsSentAt:      tracking.homeOfficeDocsSentAt || null,
      homeOfficeDocsRef:         tracking.homeOfficeDocsRef || null,
    });
  } catch (err) {
    logger.error({ err }, "getGovernmentCredentials failed");
    return ApiResponse.error(res, "Failed to retrieve credentials", 500, err);
  }
};

// POST /:id/government-credentials  (legacy — kept for backward compat)
export const confirmGovernmentCredentialsReceived = async (req, res) => {
  try {
    const application = await ownedApp(req);
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

// POST /:id/submit-credentials
// Sponsor enters the UKVI credentials they received via email and shares them with the case team.
export const submitSponsorUkviCredentials = async (req, res) => {
  try {
    const application = await ownedApp(req);
    if (!application) return ApiResponse.notFound(res, "Licence application not found");

    const data = await submitUkviCredentials(req.tenantDb, application, req.user, req.validated?.body ?? req.body, req);
    return ApiResponse.success(res, "UKVI credentials submitted to your case team", data);
  } catch (err) {
    if (err.statusCode === 400) return ApiResponse.badRequest(res, err.message);
    logger.error({ err }, "submitSponsorUkviCredentials failed");
    return ApiResponse.error(res, "Failed to submit credentials", 500, err);
  }
};

// POST /:id/confirm-payment
// Sponsor confirms they have paid the UKVI licence fee on the UKVI portal.
export const confirmSponsorUkviPayment = async (req, res) => {
  try {
    const application = await ownedApp(req);
    if (!application) return ApiResponse.notFound(res, "Licence application not found");

    const data = await confirmUkviPayment(req.tenantDb, application, req.user, req);
    return ApiResponse.success(res, "UKVI payment confirmation recorded", data);
  } catch (err) {
    logger.error({ err }, "confirmSponsorUkviPayment failed");
    return ApiResponse.error(res, "Failed to confirm payment", 500, err);
  }
};
