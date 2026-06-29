/**
 * platformSettings.controller.js
 * Handlers for the three platform settings groups:
 *   - Identity   GET/PATCH /superadmin/settings/identity
 *                POST      /superadmin/settings/identity/logo
 *                POST      /superadmin/settings/identity/favicon
 *   - Connectivity GET/PATCH /superadmin/settings/connectivity
 *                  POST      /superadmin/settings/connectivity/smtp/test
 *   - Security   GET/PATCH /superadmin/settings/security
 *
 * All routes are already protected by verifyToken + isPlatformStaff in the router.
 */

import path from "path";
import nodemailer from "nodemailer";
import catchAsync from "../../utils/catchAsync.js";
import ApiResponse from "../../utils/apiResponse.js";
import {
  getSettingsByNamespace,
  upsertSetting,
  upsertNamespacedSettings,
  decryptValue,
  maskValue,
} from "../../services/settings.service.js";
import {
  clearMailTransportCache,
  loadPlatformSmtpConfig,
  sendTransactionalEmail,
} from "../../services/mail.service.js";
import { generateDiagnosticTemplate } from "../../utils/emailTemplates.js";
import { getOrganisationEmailBranding } from "../../utils/emailBranding.js";
import { toPublicImagePath } from "../../utils/storagePath.util.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a string "true"/"false"/boolean to a boolean. */
function parseBool(val) {
  if (typeof val === "boolean") return val;
  return String(val).toLowerCase() === "true";
}

/** Parse a string or number to an integer, returning null if invalid. */
function parseIntOrNull(val) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : null;
}

// Keys that belong to each namespace
const IDENTITY_KEYS = [
  "platform_name",
  "support_email",
  "platform_address",
  "default_locale",
  "timezone",
  "maintenance_mode",
  "signups_enabled",
  "analytics_enabled",
];

const SMTP_FIELDS = ["host", "username", "password", "port", "encryption"];
const S3_FIELDS = ["bucket_name", "region", "access_key", "secret_key", "endpoint"];

const SECURITY_KEYS = [
  "mfa_enforced",
  "ip_whitelist_enabled",
  "session_persistence",
  "inactivity_timeout_minutes",
];

// ---------------------------------------------------------------------------
// GROUP 1 — Identity
// ---------------------------------------------------------------------------

export const getIdentitySettings = catchAsync(async (req, res) => {
  const raw = await getSettingsByNamespace(null); // fetch all rows

  // Build a flat object with only identity keys; provide sensible defaults
  const data = {
    platform_name:      raw["platform_name"]      ?? "ElitePic",
    support_email:      raw["support_email"]       ?? "",
    platform_address:   raw["platform_address"]    ?? "",
    default_locale:     raw["default_locale"]      ?? "en-GB",
    timezone:           raw["timezone"]            ?? "Europe/London",
    maintenance_mode:   parseBool(raw["maintenance_mode"]   ?? false),
    signups_enabled:    parseBool(raw["signups_enabled"]    ?? true),
    analytics_enabled:  parseBool(raw["analytics_enabled"] ?? true),
    logo_url:           raw["logo_url"]            ?? null,
    favicon_url:        raw["favicon_url"]         ?? null,
  };

  return ApiResponse.success(res, "Identity settings retrieved", { settings: data });
});

export const updateIdentitySettings = catchAsync(async (req, res) => {
  const allowed = new Set(IDENTITY_KEYS);
  const updates = {};

  for (const [key, value] of Object.entries(req.body)) {
    if (!allowed.has(key)) continue; // silently ignore unknown keys
    updates[key] = value;
  }

  if (Object.keys(updates).length === 0) {
    return ApiResponse.badRequest(res, "No valid identity fields provided");
  }

  // Upsert each key individually (no namespace prefix for identity keys)
  await Promise.all(
    Object.entries(updates).map(([key, value]) => upsertSetting(key, value))
  );

  return ApiResponse.success(res, "Identity settings updated");
});

// ---------------------------------------------------------------------------
// GROUP 2 — Connectivity (SMTP + S3)
// ---------------------------------------------------------------------------

/**
 * Build the connectivity response object.
 * When reveal=true the actual decrypted secrets are returned;
 * otherwise sensitive fields are masked.
 */
async function buildConnectivityResponse(reveal = false) {
  const smtpRaw = await getSettingsByNamespace("smtp");
  const s3Raw   = await getSettingsByNamespace("s3");

  const smtp = {
    host:       smtpRaw["host"]       ?? "",
    username:   smtpRaw["username"]   ?? "",
    password:   reveal ? (smtpRaw["password"] ?? "") : maskValue(),
    port:       smtpRaw["port"]       ?? "587",
    encryption: smtpRaw["encryption"] ?? "tls",
  };

  const s3 = {
    bucket_name: s3Raw["bucket_name"] ?? "",
    region:      s3Raw["region"]      ?? "",
    access_key:  reveal ? (s3Raw["access_key"] ?? "") : maskValue(),
    secret_key:  reveal ? (s3Raw["secret_key"] ?? "") : maskValue(),
    endpoint:    s3Raw["endpoint"]    ?? "",
  };

  return { smtp, s3 };
}

export const getConnectivitySettings = catchAsync(async (req, res) => {
  // Only superadmins can reveal secrets
  const reveal = req.query.reveal === "true" && req.isPlatformSuperAdmin;
  const data = await buildConnectivityResponse(reveal);
  return ApiResponse.success(res, "Connectivity settings retrieved", { settings: data });
});

export const updateConnectivitySettings = catchAsync(async (req, res) => {
  const { smtp = {}, s3 = {} } = req.body;

  const smtpUpdates = {};
  for (const field of SMTP_FIELDS) {
    if (smtp[field] === undefined) continue;
    if (field === "password" && (!smtp[field] || smtp[field] === maskValue())) continue;
    smtpUpdates[field] = smtp[field];
  }

  const s3Updates = {};
  for (const field of S3_FIELDS) {
    if (s3[field] !== undefined) s3Updates[field] = s3[field];
  }

  if (Object.keys(smtpUpdates).length === 0 && Object.keys(s3Updates).length === 0) {
    return ApiResponse.badRequest(res, "No valid connectivity fields provided");
  }

  if (Object.keys(smtpUpdates).length > 0) {
    await upsertNamespacedSettings("smtp", smtpUpdates);
    clearMailTransportCache();
  }
  if (Object.keys(s3Updates).length > 0) {
    await upsertNamespacedSettings("s3", s3Updates);
  }

  return ApiResponse.success(res, "Connectivity settings updated");
});

/**
 * POST /superadmin/settings/connectivity/smtp/test
 * Reads the saved SMTP config, builds a transporter, and calls verify().
 */
export const testSmtpConnection = catchAsync(async (req, res) => {
  const smtpRaw = await getSettingsByNamespace("smtp");

  const host       = smtpRaw["host"]       ?? "";
  const username   = smtpRaw["username"]   ?? "";
  const password   = smtpRaw["password"]   ?? ""; // already decrypted by getSettingsByNamespace
  const port       = parseInt(smtpRaw["port"] ?? "587", 10);
  const encryption = smtpRaw["encryption"] ?? "tls";

  if (!host || !username || !password) {
    return ApiResponse.badRequest(res, "SMTP host, username, and password must be configured before testing");
  }

  const secure = encryption === "ssl" || port === 465;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    ...( !secure && port === 587 ? { requireTLS: true } : {} ),
    auth: { user: username, pass: password },
  });

  try {
    await transporter.verify();
    return ApiResponse.success(res, "SMTP connection verified", { ok: true });
  } catch (err) {
    return ApiResponse.success(res, "SMTP connection failed", { ok: false, error: err.message });
  }
});

/**
 * POST /superadmin/settings/connectivity/smtp/send-test
 * Sends a real message using the same path as org welcome emails (mail.service).
 */
export const sendSmtpTestEmail = catchAsync(async (req, res) => {
  const to = String(req.body?.to || "").trim().toLowerCase();
  if (!to || !to.includes("@")) {
    return ApiResponse.badRequest(res, "A valid recipient email (to) is required");
  }

  const config = await loadPlatformSmtpConfig();
  if (!config?.user || !config?.pass) {
    return ApiResponse.badRequest(
      res,
      "SMTP is not configured. Save host, username, and password under Connectivity first.",
    );
  }

  const smtpOwner = config.user;

  const branding = await getOrganisationEmailBranding(null);

  const result = await sendTransactionalEmail({
    to,
    subject: `${branding.orgName} — SMTP test email`,
    text: `This is a test email from ${branding.orgName} platform SMTP. If you received it, transactional mail is working.`,
    html: generateDiagnosticTemplate({ source: config.source, message: `This is a test email from ${branding.orgName} platform SMTP.`, branding }),
    failureContext: "Superadmin Connectivity — Send test email",
    forcePlatformSmtp: true,
  });

  if (!result.sent) {
    return ApiResponse.success(res, "Test email could not be sent", {
      ok: false,
      error: result.error || result.reason || "send_failed",
      usedSource: result.usedSource,
      ownerNotified: Boolean(result.ownerNotified),
      smtpOwnerInbox: smtpOwner,
    });
  }

  return ApiResponse.success(res, `Test email sent to ${to}`, {
    ok: true,
    deliveryStatus: result.deliveryStatus || "accepted_by_smtp",
    messageId: result.messageId,
    usedSource: result.usedSource,
    from: config.from || config.user,
    recipient: to,
  });
});

// ---------------------------------------------------------------------------
// GROUP 3 — Security
// ---------------------------------------------------------------------------

export const getSecuritySettings = catchAsync(async (req, res) => {
  const raw = await getSettingsByNamespace("security");

  const data = {
    mfa_enforced:               parseBool(raw["mfa_enforced"]               ?? true),
    ip_whitelist_enabled:       parseBool(raw["ip_whitelist_enabled"]       ?? false),
    session_persistence:        parseBool(raw["session_persistence"]        ?? true),
    inactivity_timeout_minutes: parseIntOrNull(raw["inactivity_timeout_minutes"] ?? 30) ?? 30,
  };

  return ApiResponse.success(res, "Security settings retrieved", { settings: data });
});

export const updateSecuritySettings = catchAsync(async (req, res) => {
  const allowed = new Set(SECURITY_KEYS);
  const updates = {};

  for (const [key, value] of Object.entries(req.body)) {
    if (!allowed.has(key)) continue;
    updates[key] = value;
  }

  if (Object.keys(updates).length === 0) {
    return ApiResponse.badRequest(res, "No valid security fields provided");
  }

  await upsertNamespacedSettings("security", updates);

  return ApiResponse.success(res, "Security settings updated");
});

// ---------------------------------------------------------------------------
// Brand asset uploads — logo & favicon
// ---------------------------------------------------------------------------

/**
 * POST /superadmin/settings/identity/logo
 * Multer (handlePlatformLogoUpload) runs before this handler.
 * Saves the public URL to platform_settings key "logo_url".
 */
export const uploadPlatformLogo = catchAsync(async (req, res) => {
  if (!req.file) {
    return ApiResponse.badRequest(res, "No logo file received");
  }

  // Store the RELATIVE public path; the frontend resolves it to a full URL.
  const logoUrl = toPublicImagePath(req.file.path);

  await upsertSetting("logo_url", logoUrl);

  return ApiResponse.success(res, "Platform logo uploaded", { logo_url: logoUrl });
});

/**
 * POST /superadmin/settings/identity/favicon
 * Multer (handlePlatformFaviconUpload) runs before this handler.
 * Saves the public URL to platform_settings key "favicon_url".
 */
export const uploadPlatformFavicon = catchAsync(async (req, res) => {
  if (!req.file) {
    return ApiResponse.badRequest(res, "No favicon file received");
  }

  const faviconUrl = toPublicImagePath(req.file.path);

  await upsertSetting("favicon_url", faviconUrl);

  return ApiResponse.success(res, "Platform favicon uploaded", { favicon_url: faviconUrl });
});
