// Microsoft Controller
// Created at: 2026-05-29

import * as microsoftOauth from "./microsoft.oauth.js";
import * as microsoftService from "./microsoft.service.js";
import logger from "../../../../utils/logger.js";

/**
 * GET /api/microsoft/auth-url
 * Generates the offline Microsoft redirection URL.
 */
export const getMicrosoftAuthUrl = async (req, res) => {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    const token = (authHeader && authHeader.startsWith("Bearer ")) 
      ? authHeader.split(" ")[1] 
      : req.cookies?.token;

    const authUrl = microsoftOauth.getAuthUrl(token || "");

    return res.status(200).json({
      status: "success",
      authUrl,
      data: {
        authUrl,
        configured: true,
      },
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to generate Microsoft OAuth URL");
    return res.status(500).json({
      status: "error",
      message: "Failed to generate Microsoft auth URL: " + error.message,
      data: null,
    });
  }
};

/**
 * GET /api/microsoft/callback
 * Handles Microsoft redirect callbacks, exchanges tokens, and links account.
 */
export const getMicrosoftCallback = async (req, res) => {
  const { code } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

  if (!req.user) {
    logger.error("Unauthorized callback request - missing Microsoft user context");
    return res.redirect(`${frontendUrl}/${req.user?.role || 'caseworker'}/settings/integrations?sync=microsoft_unauthorized`);
  }

  if (!code) {
    logger.warn("Microsoft callback triggered without auth code");
    return res.redirect(`${frontendUrl}/${req.user?.role || 'caseworker'}/settings/integrations?sync=microsoft_error`);
  }

  try {
    const tokens = await microsoftOauth.exchangeCodeForTokens(code);
    
    if (!tokens.access_token) {
      throw new Error("No access token returned from Microsoft Graph authorization");
    }

    const profile = await microsoftOauth.getMicrosoftProfile(tokens.access_token);

    const details = {
      provider_user_id: profile.id,
      provider_account_name: profile.name || profile.email,
      email: profile.email,
      access_token: tokens.access_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000),
      scopes: tokens.scope || "",
    };

    if (tokens.refresh_token) {
      details.refresh_token = tokens.refresh_token;
    }

    await microsoftService.saveConnection(
      req.tenantDb,
      req.user.id,
      req.user.organisation_id,
      details
    );

    logger.info({ userId: req.user.id }, "Successfully connected Microsoft Teams Calendar integration");
    return res.redirect(`${frontendUrl}/${req.user?.role || 'caseworker'}/settings/integrations?sync=microsoft_success`);
  } catch (error) {
    logger.error({ err: error, userId: req.user?.id }, "Microsoft OAuth Callback failed");
    return res.redirect(`${frontendUrl}/${req.user?.role || 'caseworker'}/settings/integrations?sync=microsoft_error`);
  }
};

/**
 * GET /api/microsoft/status
 * Retrieves connection details.
 */
export const getMicrosoftStatus = async (req, res) => {
  try {
    const connection = await microsoftService.getConnection(req.tenantDb, req.user.id);
    
    if (!connection) {
      return res.status(200).json({
        status: "success",
        message: "No active connection",
        data: {
          isConnected: false,
          microsoftEmail: null,
          isTokenExpired: false,
        },
      });
    }

    // Check token expiration bounds
    const isTokenExpired = connection.expires_at && new Date(connection.expires_at) < new Date();

    return res.status(200).json({
      status: "success",
      message: "Microsoft integration status",
      data: {
        isConnected: true,
        microsoftEmail: connection.email,
        isTokenExpired,
      },
    });
  } catch (error) {
    logger.error({ err: error, userId: req.user.id }, "Failed to load Microsoft status");
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve Microsoft integration status: " + error.message,
      data: null,
    });
  }
};

/**
 * POST /api/microsoft/disconnect
 * Disconnects Microsoft Calendar.
 */
export const disconnectMicrosoft = async (req, res) => {
  try {
    const success = await microsoftService.disconnectConnection(req.tenantDb, req.user.id);
    
    if (!success) {
      return res.status(404).json({
        status: "error",
        message: "No active Microsoft integration found.",
        data: null,
      });
    }

    return res.status(200).json({
      status: "success",
      message: "Successfully disconnected Microsoft 365 calendar",
      data: { disconnected: true },
    });
  } catch (error) {
    logger.error({ err: error, userId: req.user.id }, "Failed to disconnect Microsoft integration");
    return res.status(500).json({
      status: "error",
      message: "Failed to disconnect: " + error.message,
      data: null,
    });
  }
};
