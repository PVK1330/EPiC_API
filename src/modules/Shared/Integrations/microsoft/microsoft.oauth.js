// Microsoft OAuth Helper
// Created at: 2026-05-29

import logger from "../../../../utils/logger.js";

/**
 * Builds the Microsoft OAuth2 consent screen authorization URL.
 */
export const getAuthUrl = (state) => {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI;
  const authority = process.env.MICROSOFT_AUTHORITY || "https://login.microsoftonline.com/common";

  if (!clientId || !redirectUri) {
    throw new Error("Microsoft OAuth configuration is missing. Ensure MICROSOFT_CLIENT_ID and MICROSOFT_REDIRECT_URI are set.");
  }

  // Graph scopes for calendars and online meetings
  const scopes = [
    "offline_access",
    "User.Read",
    "OnlineMeetings.ReadWrite",
    "Calendars.ReadWrite"
  ].join(" ");

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: scopes,
  });

  if (state) {
    params.append("state", state);
  }

  return `${authority}/oauth2/v2.0/authorize?${params.toString()}`;
};

/**
 * Exchanges Microsoft auth code for access and refresh tokens.
 */
export const exchangeCodeForTokens = async (code) => {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI;
  const authority = process.env.MICROSOFT_AUTHORITY || "https://login.microsoftonline.com/common";

  const scopes = [
    "offline_access",
    "User.Read",
    "OnlineMeetings.ReadWrite",
    "Calendars.ReadWrite"
  ].join(" ");

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    scope: scopes,
  });

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
