/**
 * Microsoft / Graph integration placeholders.
 * Wire OAuth + token storage here when Azure app registration is ready.
 *
 * NOTE: The production Microsoft OAuth flow (with single-use, server-stored
 * `state` CSRF nonces) lives in ./microsoft/microsoft.controller.js and
 * ./oauthCallback.middleware.js. This module only serves the lightweight
 * status/auth-url placeholders mounted at ./microsoft.routes.js.
 */

import logger from '../../../utils/logger.js';
import * as microsoftService from './microsoft/microsoft.service.js';

const buildAuthUrl = () => {
  const clientId = process.env.MS_CLIENT_ID;
  const redirectUri = process.env.MS_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return null;
  }
  const scope = encodeURIComponent(
    process.env.MS_SCOPES ||
      'offline_access User.Read OnlineMeetings.ReadWrite Calendars.ReadWrite',
  );
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope,
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
};

export const getMicrosoftStatus = async (req, res) => {
  try {
    // BUG-040: resolve real connection state from the tenant DB instead of a stub.
    const userId = req.user?.id ?? req.user?.userId;
    const connection = req.tenantDb
      ? await microsoftService.getConnection(req.tenantDb, userId)
      : null;

    const isTokenExpired = Boolean(
      connection?.expires_at && new Date(connection.expires_at) < new Date(),
    );

    res.status(200).json({
      status: 'success',
      message: 'Microsoft integration status',
      data: {
        isConnected: Boolean(connection?.is_active),
        microsoftEmail: connection?.email ?? null,
        isTokenExpired,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Microsoft status error');
    res.status(500).json({
      status: 'error',
      message: 'Failed to load Microsoft status',
      data: null,
    });
  }
};

export const getMicrosoftAuthUrl = async (req, res) => {
  try {
    const authUrl = buildAuthUrl();
    res.status(200).json({
      status: 'success',
      message: authUrl
        ? 'Authorization URL generated'
        : 'Microsoft OAuth is not configured (set MS_CLIENT_ID and MS_REDIRECT_URI)',
      data: {
        authUrl,
        configured: Boolean(authUrl),
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Microsoft auth URL error');
    res.status(500).json({
      status: 'error',
      message: 'Failed to build Microsoft auth URL',
      data: null,
    });
  }
};

export const refreshMicrosoftToken = async (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Token refresh not implemented',
    data: { refreshed: false },
  });
};

export const disconnectMicrosoft = async (req, res) => {
  try {
    // BUG-040: clear stored Microsoft tokens for this user via the real service.
    const userId = req.user?.id ?? req.user?.userId;
    if (req.tenantDb) {
      await microsoftService.disconnectConnection(req.tenantDb, userId);
    }
    res.status(200).json({
      status: 'success',
      message: 'Disconnected',
      data: { disconnected: true },
    });
  } catch (error) {
    logger.error({ err: error }, 'Microsoft disconnect error');
    res.status(500).json({
      status: 'error',
      message: 'Failed to disconnect',
      data: null,
    });
  }
};
