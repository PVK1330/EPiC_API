// Microsoft Token Service
// Created at: 2026-05-29

import { encryptValue, decryptValue } from "../../../../services/settings.service.js";
import logger from "../../../../utils/logger.js";

/**
 * Ensures user has a valid Microsoft Graph access token.
 * Refreshes automatically if expired. Enforces encryption boundaries.
 */
export const getOrRefreshAccessToken = async (connection) => {
  if (!connection) {
    throw new Error("Missing calendar connection context.");
  }

  const now = new Date();
  const bufferTime = 5 * 60 * 1000; // 5 minute buffer

  if (connection.expires_at && new Date(connection.expires_at).getTime() - bufferTime > now.getTime()) {
    const decryptedAccess = decryptValue(connection.access_token);
    if (decryptedAccess) return decryptedAccess;
    return connection.access_token;
  }

  if (!connection.refresh_token) {
    throw new Error("Microsoft refresh token is missing. Please reconnect your account.");
  }

  const decryptedRefresh = decryptValue(connection.refresh_token) || connection.refresh_token;

  try {
    logger.info({ userId: connection.user_id }, "Refreshing Microsoft Graph access token");

    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI;
    const authority = process.env.MICROSOFT_AUTHORITY || "https://login.microsoftonline.com/common";

    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decryptedRefresh,
      grant_type: "refresh_token",
      redirect_uri: redirectUri,
    });

    const response = await fetch(`${authority}/oauth2/v2.0/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Microsoft Token refresh failed: ${response.statusText} - ${errorBody}`);
    }

    const data = await response.json();
    const newAccessToken = data.access_token;

    if (!newAccessToken) {
      throw new Error("Microsoft OAuth returned empty access token.");
    }

    const expiresAt = new Date(Date.now() + data.expires_in * 1000);
    const encryptedAccess = encryptValue(newAccessToken);

    const patch = {
      access_token: encryptedAccess,
      expires_at: expiresAt,
    };

    // Sometimes Microsoft returns a new refresh token, if so, encrypt and save it
    if (data.refresh_token) {
      patch.refresh_token = encryptValue(data.refresh_token);
    }

    await connection.update(patch);

    return newAccessToken;
  } catch (error) {
    logger.error({ err: error, userId: connection.user_id }, "Failed to refresh Microsoft OAuth token");

    if (error.message?.includes("invalid_grant")) {
      await connection.update({ is_active: false });
      throw new Error("Your Microsoft connection has been revoked or expired. Please reconnect.");
    }

    throw error;
  }
};
