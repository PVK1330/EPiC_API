// Microsoft OAuth Helper
// Created at: 2026-05-29

import logger from "../../../../utils/logger.js";
import platformDb from "../../../../models/index.js";
import { decryptValue } from "../../../../services/settings.service.js";

const GRAPH_SCOPES = [
  "offline_access",
  "User.Read",
  "OnlineMeetings.ReadWrite",
  "Calendars.ReadWrite",
].join(" ");

const AUTHORITY_HOST = "https://login.microsoftonline.com";

// The Express route that actually handles the provider redirect. Kept as a
// constant so the derived redirect URI can never drift from routes/index.js
// (`router.use('/microsoft', microsoftRoutes)` + `router.get('/callback')`).
export const MICROSOFT_CALLBACK_PATH = "/api/microsoft/callback";

function trimOrNull(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

/** Accept either a full authority URL or a bare directory GUID / alias. */
function normaliseAuthority(value) {
  const raw = trimOrNull(value);
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, "");
  return `${AUTHORITY_HOST}/${raw.replace(/^\/+|\/+$/g, "")}`;
}

function apiBaseUrl() {
  const base =
    trimOrNull(process.env.BASE_URL) ||
    trimOrNull(process.env.API_URL)?.replace(/\/api\/?$/i, "");
  return base ? base.replace(/\/+$/, "") : null;
}

/**
 * Merge per-organisation Microsoft OAuth settings with server env fallbacks.
 * Tenant secrets are stored encrypted; decryptValue passes plain text through.
 * Returns null when client id, secret, or redirect URI are still missing.
 */
export function resolveMicrosoftOAuthConfig(tenantConfig = null) {
  const tenant =
    tenantConfig && typeof tenantConfig === "object" ? tenantConfig : {};

  const tenantSecret = trimOrNull(tenant.client_secret || tenant.clientSecret);

  // Fall back to the API's own callback route rather than leaving this blank —
  // a redirect URI pointing anywhere else 404s after the user consents.
  const base = apiBaseUrl();
  const envRedirect =
    trimOrNull(process.env.MICROSOFT_REDIRECT_URI) ||
    (base ? `${base}${MICROSOFT_CALLBACK_PATH}` : null);

  const merged = {
    client_id: trimOrNull(tenant.client_id || tenant.clientId) ||
      trimOrNull(process.env.MICROSOFT_CLIENT_ID),
    client_secret:
      (tenantSecret ? decryptValue(tenantSecret) : null) ||
      trimOrNull(process.env.MICROSOFT_CLIENT_SECRET),
    redirect_uri: trimOrNull(tenant.redirect_uri || tenant.redirectUri) || envRedirect,
    // `MICROSOFT_TENANT_ID` is honoured so a directory GUID alone is enough to
    // pin sign-in to one organisation. Default is `organizations` (any work or
    // school account) — NOT `common`, which also admits personal Microsoft
    // accounts that cannot call /me/onlineMeetings and so 403 after connecting.
    authority:
      normaliseAuthority(tenant.authority) ||
      normaliseAuthority(tenant.tenant_id || tenant.tenantId) ||
      normaliseAuthority(process.env.MICROSOFT_AUTHORITY) ||
      normaliseAuthority(process.env.MICROSOFT_TENANT_ID) ||
      `${AUTHORITY_HOST}/organizations`,
  };

  if (!merged.client_id || !merged.client_secret || !merged.redirect_uri) {
    return null;
  }

  if (!merged.redirect_uri.endsWith(MICROSOFT_CALLBACK_PATH)) {
    logger.warn(
      { redirectUri: merged.redirect_uri, expectedPath: MICROSOFT_CALLBACK_PATH },
      "Microsoft redirect URI does not point at the callback route; Microsoft will redirect to a path this API does not serve",
    );
  }

  return merged;
}

export function isMicrosoftOAuthConfigured(tenantConfig = null) {
  return resolveMicrosoftOAuthConfig(tenantConfig) !== null;
}

/** Load optional per-org Microsoft block from organisations.smtp_settings. */
export async function loadTenantMicrosoftConfig(organisationId) {
  if (!organisationId) return null;
  try {
    const org = await platformDb.Organisation.findByPk(organisationId, {
      attributes: ["id", "smtp_settings"],
    });
    const raw = org?.smtp_settings || {};
    return raw?.microsoft || raw?.integrations?.microsoft || null;
  } catch (err) {
    logger.warn({ err }, "Failed to read organisation Microsoft OAuth settings");
    return null;
  }
}

/**
 * Builds the Microsoft OAuth2 consent screen authorization URL.
 */
export const getAuthUrl = (state, tenantConfig = null) => {
  const config = resolveMicrosoftOAuthConfig(tenantConfig);
  if (!config) {
    throw new Error("Microsoft OAuth configuration is missing. Ensure MICROSOFT_CLIENT_ID and MICROSOFT_REDIRECT_URI are set (or add Microsoft credentials under organisation settings).");
  }

  const params = new URLSearchParams({
    client_id: config.client_id,
    response_type: "code",
    redirect_uri: config.redirect_uri,
    response_mode: "query",
    scope: GRAPH_SCOPES,
  });

  if (state) {
    params.append("state", state);
  }

  return `${config.authority}/oauth2/v2.0/authorize?${params.toString()}`;
};

/**
 * Exchanges Microsoft auth code for access and refresh tokens.
 */
export const exchangeCodeForTokens = async (code, tenantConfig = null) => {
  const config = resolveMicrosoftOAuthConfig(tenantConfig);
  if (!config) {
    throw new Error("Microsoft OAuth is not configured. Cannot exchange code for tokens.");
  }

  const params = new URLSearchParams({
    client_id: config.client_id,
    client_secret: config.client_secret,
    code,
    redirect_uri: config.redirect_uri,
    grant_type: "authorization_code",
    scope: GRAPH_SCOPES,
  });

  const authority = config.authority;

  const url = `${authority}/oauth2/v2.0/token`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Microsoft Token Exchange failed: ${response.statusText} - ${errorBody}`);
  }

  return await response.json();
};

/**
 * Fetches user profile from Microsoft Graph API.
 */
export const getMicrosoftProfile = async (accessToken) => {
  const url = "https://graph.microsoft.com/v1.0/me";

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Microsoft Graph Profile fetch failed: ${response.statusText}`);
  }

  const profile = await response.json();
  return {
    id: profile.id,
    email: profile.mail || profile.userPrincipalName,
    name: profile.displayName,
  };
};
