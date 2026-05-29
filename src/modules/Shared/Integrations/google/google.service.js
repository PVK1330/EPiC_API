// Google Service
// Created at: 2026-05-29

import { encryptValue, decryptValue } from "../../../../services/settings.service.js";
import logger from "../../../../utils/logger.js";
import { getOAuth2Client } from "./google.oauth.js";
import { loadTenantGoogleConfig } from "./google.config.js";

/**
 * Loads the active Google Calendar Connection for a user.
 */
export const getConnection = async (tenantDb, userId) => {
  if (!tenantDb?.CalendarConnection) {
    throw new Error("CalendarConnection model is not registered on this tenant.");
  }

  return await tenantDb.CalendarConnection.findOne({
    where: {
      user_id: userId,
      provider: "google",
      is_active: true,
    },
  });
};

/**
 * Saves or updates a Google Calendar Connection for a user.
 * Encrypts sensitive credentials before storage.
 */
export const saveConnection = async (tenantDb, userId, organisationId, details) => {
  if (!tenantDb?.CalendarConnection) {
    throw new Error("CalendarConnection model is not registered on this tenant.");
  }

  const {
    provider_user_id,
    provider_account_name,
    email,
    access_token,
    refresh_token,
    expires_at,
    scopes,
  } = details;

  // Encrypt the sensitive tokens
  const encryptedAccess = encryptValue(access_token);
  const encryptedRefresh = refresh_token ? encryptValue(refresh_token) : null;

  const defaults = {
    provider_user_id,
    provider_account_name,
    email,
    access_token: encryptedAccess,
    expires_at,
    scopes,
    is_active: true,
    organisation_id: organisationId,
  };

  if (encryptedRefresh) {
    defaults.refresh_token = encryptedRefresh;
  }

  const [connection, created] = await tenantDb.CalendarConnection.findOrCreate({
    where: {
      user_id: userId,
      provider: "google",
    },
    defaults,
  });

  if (!created) {
    // If not created, perform update
    const patch = {
      provider_user_id,
      provider_account_name,
      email,
      access_token: encryptedAccess,
      expires_at,
      scopes,
      is_active: true,
      organisation_id: organisationId,
    };
    if (encryptedRefresh) {
      patch.refresh_token = encryptedRefresh;
    }
    await connection.update(patch);
  }

  return connection;
};

/**
 * Revokes Google API tokens and deletes the connection record.
 */
export const disconnectConnection = async (tenantDb, userId) => {
  const connection = await getConnection(tenantDb, userId);
  if (!connection) {
    return false;
  }

  // Revoke token via Google OAuth if refresh token is available
  try {
    const decryptedRefresh = decryptValue(connection.refresh_token) || connection.refresh_token;
    if (decryptedRefresh) {
      const tenantGoogleConfig = await loadTenantGoogleConfig(
        connection.organisation_id,
      );
      const oauth2Client = getOAuth2Client(tenantGoogleConfig);
      if (oauth2Client) {
        await oauth2Client.revokeToken(decryptedRefresh);
        logger.info({ userId }, "Successfully revoked Google Calendar OAuth token");
      } else {
        // If no OAuth client available (no tenant or global config), skip revoke gracefully
        logger.warn({ userId }, "No Google OAuth client configured for tenant; skipping revoke step");
      }
    }
  } catch (err) {
    // Gracefully handle already revoked/expired tokens without failing the DB disconnection
    logger.warn({ err }, "Google Calendar token revocation returned an error, proceeding to clean DB row");
  }

  // Delete local connection record
  await connection.destroy();
  return true;
};
