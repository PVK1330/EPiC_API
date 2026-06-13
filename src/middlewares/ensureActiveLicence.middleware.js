// Deprecated shim — the licence gate now lives in requireActiveSponsorLicence.middleware.js.
// Re-exported here so existing imports keep working with a single implementation.
export {
  requireActiveSponsorLicence,
  ensureActiveLicence,
  INACTIVE_LICENCE_MESSAGE,
  default,
} from "./requireActiveSponsorLicence.middleware.js";
