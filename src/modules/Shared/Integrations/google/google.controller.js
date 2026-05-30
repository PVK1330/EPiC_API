// Google Controller
// Created at: 2026-05-29

import * as googleOauth from "./google.oauth.js";
import * as googleService from "./google.service.js";
import { isGoogleOAuthConfigured, loadTenantGoogleConfigForRequest } from "./google.config.js";
import {
  buildFrontendOAuthRedirect,
  getRequestUserId,
  resolveTenantUserId,
} from "./google.integration.util.js";
import logger from "../../../../utils/logger.js";

/**
 * GET /api/google/auth-url
 * Generates the offline-consent Google OAuth redirection URL.
 */
export const getGoogleAuthUrl = async (req, res) => {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    const token =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : req.cookies?.token;

    const tenantGoogleConfig = await loadTenantGoogleConfigForRequest(req);

    if (!isGoogleOAuthConfigured(tenantGoogleConfig)) {
      return res.status(400).json({
        status: "error",
        message:
          "Google OAuth is not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI to the server .env, then restart the API.",
        data: { configured: false },
      });
    }

    const authUrl = googleOauth.getAuthUrl(token || "", tenantGoogleConfig);

    return res.status(200).json({
      status: "success",
      url: authUrl,
      data: {
        url: authUrl,
      },
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to generate Google OAuth URL");
    const isConfigError = error.message && error.message.includes("not configured");
    return res.status(isConfigError ? 400 : 500).json({
      status: "error",
      message: "Failed to generate Google auth URL: " + error.message,
      data: null,
    });
  }
};

/**
 * GET /api/google/callback
 * Handles OAuth callback code redirection, exchanges token, and updates DB.
 */
export const getGoogleCallback = async (req, res) => {
  const { code, error: oauthError, error_description: oauthErrorDescription } =
    req.query;

  if (!req.user) {
    logger.error("Unauthorized Google OAuth callback — could not restore session from state/cookie");
    const fallback = (process.env.FRONTEND_URL?.split(",")[0]?.trim() || "http://localhost:5173").replace(/\/$/, "");
    return res.redirect(`${fallback}/login?sync=google_unauthorized`);
  }

  if (oauthError) {
    logger.warn(
      { oauthError, oauthErrorDescription, userId: getRequestUserId(req) },
      "Google OAuth returned an error to the callback",
    );
    const sync =
      oauthError === "access_denied" ? "google_access_denied" : "google_error";
    return res.redirect(buildFrontendOAuthRedirect(req, sync));
  }

  if (!code) {
    logger.warn({ userId: getRequestUserId(req) }, "Google callback missing authorization code");
    return res.redirect(buildFrontendOAuthRedirect(req, "google_error"));
  }

  try {
    if (!req.tenantDb?.CalendarConnection) {
      throw new Error(
        "calendar_connections table is not available. Run: npm run migrate:tenants",
      );
    }

    const tenantUserId = await resolveTenantUserId(req);
    if (!tenantUserId) {
      throw new Error(
        "Your user account was not found in this organisation database. Try logging out and back in.",
      );
    }

    const tenantGoogleConfig = await loadTenantGoogleConfigForRequest(req);

    const tokens = await googleOauth.exchangeCodeForTokens(code, tenantGoogleConfig);

    if (!tokens.access_token) {
      throw new Error("No access token returned from Google authentication endpoint");
    }

    const profile = await googleOauth.getGoogleProfile(
      tokens.access_token,
      tenantGoogleConfig,
    );

    const details = {
      provider_user_id: profile.id || profile.sub,
      provider_account_name: profile.name || profile.email,
      email: profile.email,
      access_token: tokens.access_token,
      expires_at: tokens.expiry_date
        ? new Date(tokens.expiry_date)
        : new Date(Date.now() + 3600 * 1000),
      scopes: tokens.scope || "",
    };

    if (tokens.refresh_token) {
      details.refresh_token = tokens.refresh_token;
    }

    await googleService.saveConnection(
      req.tenantDb,
      tenantUserId,
      req.user.organisation_id,
      details,
    );

    if (req.tenantDb.AuditLog) {
      await req.tenantDb.AuditLog.create({
        user_id: tenantUserId,
        action: 'GOOGLE_CONNECTED',
        details: `Successfully connected Google account: ${profile.email}`,
        status: 'Success'
      }).catch(() => {});
    }

    if (req.tenantDb.CaseTimeline) {
      await req.tenantDb.CaseTimeline.create({
        case_id: null,
        type: 'GOOGLE_CONNECTED',
        title: 'Google Integration',
        description: `Google Calendar & Meet integration activated.`,
        icon: 'check-circle',
        created_by: tenantUserId,
      }).catch(() => {});
    }

    logger.info(
      { userId: tenantUserId, googleEmail: profile.email },
      "Successfully connected Google Calendar integration",
    );

    return res.redirect(buildFrontendOAuthRedirect(req, "google_success"));
  } catch (error) {
    logger.error(
      { err: error, userId: getRequestUserId(req) },
      "Google OAuth Callback failed",
    );
    return res.redirect(buildFrontendOAuthRedirect(req, "google_error"));
  }
};

/**
 * GET /api/google/status
 * Retrieves current Google Calendar connection status for the user.
 */
export const getGoogleStatus = async (req, res) => {
  try {
    if (!req.tenantDb?.CalendarConnection) {
      return res.status(503).json({
        connected: false,
        status: "error",
        message:
          "Calendar integration storage is not ready. Ask your administrator to run tenant migrations.",
        data: null,
      });
    }

    const tenantUserId = await resolveTenantUserId(req);
    if (!tenantUserId) {
      return res.status(200).json({
        connected: false,
        status: "success",
        message: "User not found in tenant database",
        data: { connected: false },
      });
    }

    const connection = await googleService.getConnection(req.tenantDb, tenantUserId);

    if (!connection) {
      return res.status(200).json({
        connected: false,
        status: "success",
        data: { connected: false },
      });
    }

    const isTokenExpired = connection.expires_at && new Date(connection.expires_at) < new Date();

    return res.status(200).json({
      connected: connection.is_active,
      email: connection.email,
      status: "success",
      data: {
        connected: connection.is_active,
        status: connection.last_sync_status || (connection.is_active ? 'CONNECTED' : 'DISCONNECTED'),
        email: connection.email,
        isTokenExpired,
        lastSuccessfulSync: connection.last_successful_sync,
        lastFailedSync: connection.last_failed_sync,
        errorMessage: connection.error_message,
        updatedAt: connection.updated_at,
      },
    });
  } catch (error) {
    logger.error({ err: error, userId: getRequestUserId(req) }, "Failed to load Google Calendar status");
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve Google integration status: " + error.message,
      data: null,
    });
  }
};

/**
 * POST /api/google/disconnect
 * Disconnects the Google Calendar integration, revokes API tokens, and clears DB.
 */
export const disconnectGoogle = async (req, res) => {
  try {
    const tenantUserId = await resolveTenantUserId(req);
    if (!tenantUserId) {
      return res.status(404).json({
        status: "error",
        message: "User not found in tenant database.",
        data: null,
      });
    }

    const success = await googleService.disconnectConnection(req.tenantDb, tenantUserId);

    if (!success) {
      return res.status(404).json({
        status: "error",
        message: "No active Google integration found to disconnect.",
        data: null,
      });
    }

    if (req.tenantDb.AuditLog) {
      await req.tenantDb.AuditLog.create({
        user_id: tenantUserId,
        action: 'GOOGLE_DISCONNECTED',
        details: `Disconnected Google account.`,
        status: 'Success'
      }).catch(() => {});
    }

    return res.status(200).json({
      status: "success",
      message: "Successfully disconnected and revoked Google Calendar integration",
      data: { disconnected: true },
    });
  } catch (error) {
    logger.error({ err: error, userId: getRequestUserId(req) }, "Failed to disconnect Google Calendar integration");
    return res.status(500).json({
      status: "error",
      message: "Failed to disconnect Google integration: " + error.message,
      data: null,
    });
  }
};
