// Google OAuth Helper
// Created at: 2026-05-29

import { google } from "googleapis";
import { resolveGoogleOAuthConfig } from "./google.config.js";

export { resolveGoogleOAuthConfig, isGoogleOAuthConfigured } from "./google.config.js";

/**
 * Creates and configures a Google OAuth2 client.
 */
export const getOAuth2Client = (tenantConfig = null) => {
  const config = resolveGoogleOAuthConfig(tenantConfig);
  if (!config) {
    return null;
  }

  return new google.auth.OAuth2(
    config.client_id,
    config.client_secret,
    config.redirect_uri,
  );
};

/**
 * Generates the offline-access consent screen authorization URL.
 */
export const getAuthUrl = (state, tenantConfig = null) => {
  const oauth2Client = getOAuth2Client(tenantConfig);
  if (!oauth2Client) {
    throw new Error(
      "Google OAuth is not configured for this organisation. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in the server .env (or add google credentials under organisation settings).",
    );
  }

  const scopes = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar",
  ];

  const options = {
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
  };

  if (state) {
    options.state = state;
  }

  return oauth2Client.generateAuthUrl(options);
};

/**
 * Exchanges auth code for access and refresh tokens.
 */
export const exchangeCodeForTokens = async (code, tenantConfig = null) => {
  const oauth2Client = getOAuth2Client(tenantConfig);
  if (!oauth2Client) {
    throw new Error(
      "Google OAuth is not configured for this organisation. Cannot exchange code for tokens.",
    );
  }

  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
};

/**
 * Fetches Google profile information for token identification.
 */
export const getGoogleProfile = async (accessToken, tenantConfig = null) => {
  const oauth2Client = getOAuth2Client(tenantConfig);
  if (!oauth2Client) {
    throw new Error(
      "Google OAuth is not configured for this organisation. Cannot fetch profile.",
    );
  }

  oauth2Client.setCredentials({ access_token: accessToken });

  const oauth2 = google.oauth2({
    auth: oauth2Client,
    version: "v2",
  });

  const response = await oauth2.userinfo.get();
  return response.data;
};
