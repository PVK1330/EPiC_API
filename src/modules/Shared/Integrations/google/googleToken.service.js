// Google Token Service
// Created at: 2026-05-29

import { encryptValue, decryptValue } from "../../../../services/settings.service.js";
import { getOAuth2Client } from "./google.oauth.js";
import logger from "../../../../utils/logger.js";

/**
 * Ensures user has a valid access token. Checks expiration and performs
 * automatic token replenishment if expired. Enforces encryption boundaries.
 * 
 * @param {object} tenantDb - The tenant database context
 * @param {object} connection - The calendar_connections Sequelize row instance
 * @returns {Promise<string>} Valid decrypted access token
 */
export const getOrRefreshAccessToken = async (tenantDb, connection) => {
  if (!connection) {
    throw new Error("Missing calendar connection context.");
  }

  const now = new Date();
  const bufferTime = 5 * 60 * 1000; // 5 minute buffer
  
  // If access token is still fresh, decrypt and return it
  if (connection.expires_at && new Date(connection.expires_at).getTime() - bufferTime > now.getTime()) {
    // Note: access_tokens are decrypted on demand if they were encrypted,
    // though the spec asks specifically to encrypt refresh tokens.
    // We will encrypt/decrypt access_token as well for maximum security, or just refresh_token as asked.
    // Let's support decrypting both if they are formatted as colon-delimited GCM values.
    const decryptedAccess = decryptValue(connection.access_token);
    if (decryptedAccess) return decryptedAccess;
    return connection.access_token;
  }

  // Token has expired or is expiring soon. Trigger background refresh.
  if (!connection.refresh_token) {
    throw new Error("Active integration refresh token is missing. Please reconnect your account.");
  }

  const decryptedRefresh = decryptValue(connection.refresh_token) || connection.refresh_token;

  try {
    logger.info({ userId: connection.user_id }, "Refreshing Google Calendar OAuth access token");
    // Attempt to load tenant-specific Google OAuth config from platform registry
    let tenantGoogleConfig = null;
    try {
      const platformDb = (await import("../../../../models/index.js")).default;
      const orgId = connection.organisation_id;
      if (orgId) {
        const org = await platformDb.Organisation.findByPk(orgId, { attributes: ["id", "smtp_settings"] });
        const raw = org?.smtp_settings || {};
        tenantGoogleConfig = raw?.google || raw?.integrations?.google || null;
      }
    } catch (readErr) {
      logger.warn({ err: readErr }, "Failed to read organisation settings for Google token refresh");
    }

    const oauth2Client = getOAuth2Client(tenantGoogleConfig);
    if (!oauth2Client) throw new Error("Google OAuth client is not configured for this tenant.");
    
    oauth2Client.setCredentials({
      refresh_token: decryptedRefresh,
    });

    const response = await oauth2Client.getAccessToken();
    const newAccessToken = response.token;

    if (!newAccessToken) {
      throw new Error("OAuth provider returned an empty access token during refresh.");
    }

    // Google provides expiry time or we default to 1 hour (3600s)
    const expiryInMs = oauth2Client.credentials.expiry_date
      ? oauth2Client.credentials.expiry_date
      : Date.now() + 3600 * 1000;

    const encryptedAccess = encryptValue(newAccessToken);

    await connection.update({
      access_token: encryptedAccess,
      expires_at: new Date(expiryInMs),
      last_sync_status: 'CONNECTED',
      last_successful_sync: new Date(),
    });

    if (tenantDb && tenantDb.AuditLog) {
      await tenantDb.AuditLog.create({
        user_id: connection.user_id,
        action: 'GOOGLE_TOKEN_REFRESHED',
        details: 'Google OAuth access token was refreshed automatically',
        status: 'Success'
      }).catch(() => {});
    }

    return newAccessToken;
  } catch (error) {
    logger.error({ err: error, userId: connection.user_id }, "Failed to refresh Google OAuth access token");
    
    // Check if refresh token was revoked by Google
    if (
      error.message?.includes("invalid_grant") || 
      error.response?.data?.error === "invalid_grant"
    ) {
      await connection.update({ 
        is_active: false,
        last_sync_status: 'REAUTH_REQUIRED',
        last_failed_sync: new Date(),
        error_message: error.message 
      });

      if (tenantDb && tenantDb.AuditLog) {
        await tenantDb.AuditLog.create({
          user_id: connection.user_id,
          action: 'GOOGLE_TOKEN_EXPIRED',
          details: 'Google connection revoked or refresh token expired. Reauth required.',
          status: 'Failed'
        }).catch(() => {});
      }

      throw new Error("Your Google Calendar connection has been revoked or expired. Please reconnect.");
    }
    
    await connection.update({ 
      last_sync_status: 'TOKEN_EXPIRED',
      last_failed_sync: new Date(),
      error_message: error.message 
    });

    throw error;
  }
};
