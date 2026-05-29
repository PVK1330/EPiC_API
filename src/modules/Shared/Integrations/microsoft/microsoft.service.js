// Microsoft Service
// Created at: 2026-05-29

import { encryptValue, decryptValue } from "../../../../services/settings.service.js";
import logger from "../../../../utils/logger.js";

/**
 * Loads the active Microsoft connection for a user.
 */
export const getConnection = async (tenantDb, userId) => {
  if (!tenantDb?.CalendarConnection) {
    throw new Error("CalendarConnection model is not registered on this tenant.");
  }

  return await tenantDb.CalendarConnection.findOne({
    where: {
      user_id: userId,
      provider: "microsoft",
      is_active: true,
    },
  });
};

/**
 * Saves or updates Microsoft connection for a user.
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
      provider: "microsoft",
    },
    defaults,
  });

  if (!created) {
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
 * Deletes the Microsoft connection row.
 */
export const disconnectConnection = async (tenantDb, userId) => {
  const connection = await getConnection(tenantDb, userId);
  if (!connection) {
    return false;
  }

  // Revoke token via Microsoft endpoint if possible (optional Graph API call)
  try {
    const decryptedRefresh = decryptValue(connection.refresh_token) || connection.refresh_token;
    if (decryptedRefresh) {
      // Optional Graph API OAuth revoke could be called here
      logger.info({ userId }, "Cleaned Microsoft Teams credentials");
    }
  } catch (err) {
    logger.warn({ err }, "Proceeding to clean Microsoft connection row");
  }

  await connection.destroy();
  return true;
};
