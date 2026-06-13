import ApiResponse from "../utils/apiResponse.js";
import logger from "../utils/logger.js";

const ACTIVE = "Active";

/** Exact, user-facing message when the licence gate blocks an action. */
export const INACTIVE_LICENCE_MESSAGE = "Your Sponsorship Licence is not active.";

/**
 * Licence-based access control for the Sponsor Portal.
 *
 * Blocks the request with HTTP 403 unless the calling sponsor's licence is
 * ACTIVE. Used to gate actions that require a live sponsor licence — CoS
 * requests, sponsored-worker creation, and other worker sponsorship actions —
 * while leaving licence application, profile management and compliance uploads
 * open (those routes simply do not mount this guard).
 *
 * Must run AFTER verifyTokenAndTenant (needs req.user + req.tenantDb). On
 * success it attaches the loaded profile as req.sponsorProfile for reuse.
 */
export const requireActiveSponsorLicence = () => async (req, res, next) => {
  try {
    if (!req.user || !req.tenantDb) {
      return ApiResponse.unauthorized(res, "Authentication required");
    }

    const userId = Number(req.user.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return ApiResponse.unauthorized(res, "Invalid session");
    }

    const profile = await req.tenantDb.SponsorProfile.findOne({
      where: { userId },
      attributes: ["id", "licenceStatus", "sponsorLicenceNumber", "organisation_id"],
    });

    if (!profile || profile.licenceStatus !== ACTIVE) {
      return ApiResponse.forbidden(res, INACTIVE_LICENCE_MESSAGE);
    }

    req.sponsorProfile = profile;
    return next();
  } catch (err) {
    logger.error({ err }, "requireActiveSponsorLicence error");
    return ApiResponse.error(res, "Failed to verify licence status", 500, err);
  }
};

/** @deprecated Use requireActiveSponsorLicence(). Kept for backward compatibility. */
export const ensureActiveLicence = requireActiveSponsorLicence;

export default requireActiveSponsorLicence;
