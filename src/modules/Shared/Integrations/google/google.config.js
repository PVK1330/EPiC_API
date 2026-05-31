import platformDb from "../../../../models/index.js";
import logger from "../../../../utils/logger.js";
import { decryptValue } from "../../../../services/settings.service.js";

function trimOrNull(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

/**
 * Merge per-organisation Google OAuth settings with server env fallbacks.
 * Returns null when client id, secret, or redirect URI are still missing.
 */
export function resolveGoogleOAuthConfig(tenantConfig = null) {
  const tenant =
    tenantConfig && typeof tenantConfig === "object" ? tenantConfig : {};

  const apiBase = trimOrNull(process.env.BASE_URL) ||
    trimOrNull(process.env.API_URL)?.replace(/\/api\/?$/i, "") ||
    "";

  const envClientId = trimOrNull(
    process.env.GOOGLE_CLIENT_ID || process.env.CLIENT_ID,
  );
  const envClientSecret = trimOrNull(
    process.env.GOOGLE_CLIENT_SECRET || process.env.CLIENT_SECRET,
  );

  let envRedirect = trimOrNull(process.env.GOOGLE_REDIRECT_URI);
  if (!envRedirect && apiBase) {
    envRedirect = `${apiBase.replace(/\/$/, "")}/api/google/callback`;
  }
  const genericRedirect = trimOrNull(process.env.REDIRECT_URI);
  if (
    !envRedirect &&
    genericRedirect &&
    /google\/callback/i.test(genericRedirect)
  ) {
    envRedirect = genericRedirect;
  }

  // Tenant secrets are stored encrypted; decryptValue passes plain text through
  // unchanged, so this is safe for legacy/plain values and env fallbacks too.
  const tenantSecret = trimOrNull(tenant.client_secret || tenant.clientSecret);
  const merged = {
    client_id:
      trimOrNull(tenant.client_id || tenant.clientId) || envClientId,
    client_secret:
      (tenantSecret ? decryptValue(tenantSecret) : null) || envClientSecret,
    redirect_uri:
      trimOrNull(tenant.redirect_uri || tenant.redirectUri) || envRedirect,
  };

  if (!merged.client_id || !merged.client_secret || !merged.redirect_uri) {
    return null;
  }

  return merged;
}

export function isGoogleOAuthConfigured(tenantConfig = null) {
  return resolveGoogleOAuthConfig(tenantConfig) !== null;
}

/** Load optional per-org Google block from platform organisations.smtp_settings */
export async function loadTenantGoogleConfig(organisationId) {
  if (!organisationId) return null;

  try {
    const org = await platformDb.Organisation.findByPk(organisationId, {
      attributes: ["id", "smtp_settings"],
    });
    const raw = org?.smtp_settings || {};
    return raw?.google || raw?.integrations?.google || null;
  } catch (err) {
    logger.warn({ err }, "Failed to read organisation Google OAuth settings");
    return null;
  }
}

export async function loadTenantGoogleConfigForRequest(req) {
  return loadTenantGoogleConfig(req.user?.organisation_id);
}
