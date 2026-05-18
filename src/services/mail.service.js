import nodemailer from "nodemailer";
import platformDb from "../models/index.js";

const transportCache = new Map();

/** Platform (superadmin) SMTP from environment variables. */
export function getPlatformSmtpConfig() {
  const user = String(process.env.EMAIL_USER || "").trim();
  const pass = String(process.env.EMAIL_PASS || "").trim();
  if (!user || !pass) return null;

  return {
    source: "platform",
    enabled: true,
    host: process.env.SMTP_HOST || null,
    port: process.env.SMTP_PORT || null,
    secure: process.env.SMTP_SECURE || null,
    service: process.env.EMAIL_SERVICE || "gmail",
    user,
    pass,
    from: String(process.env.EMAIL_FROM || user).trim(),
  };
}

/**
 * Parse organisation smtp_settings JSON from DB.
 * Expected shape: { enabled, host?, port?, secure?, service?, user, pass, from? }
 */
export function parseOrganisationSmtpSettings(raw) {
  if (!raw || typeof raw !== "object") return null;
  const enabled =
    raw.enabled === true ||
    raw.use_custom_smtp === true ||
    raw.useCustomSmtp === true;
  if (!enabled) return null;

  const user = String(raw.user || raw.smtp_user || raw.username || "").trim();
  const pass = String(raw.pass || raw.smtp_pass || raw.password || "").trim();
  if (!user || !pass) return null;

  return {
    source: "organisation",
    enabled: true,
    host: raw.host || raw.smtp_host || null,
    port: raw.port ?? raw.smtp_port ?? null,
    secure: raw.secure ?? raw.smtp_secure ?? null,
    service: raw.service || raw.smtp_service || null,
    user,
    pass,
    from: String(raw.from || raw.smtp_from || user).trim(),
  };
}

export function isSmtpConfigComplete(config) {
  return Boolean(config?.user && config?.pass);
}

/**
 * Organisation custom SMTP if configured; otherwise platform (.env) SMTP.
 */
export async function resolveSmtpConfig(organisationId) {
  const orgId = organisationId != null ? Number(organisationId) : null;

  if (orgId && Number.isFinite(orgId) && orgId > 0) {
    const org = await platformDb.Organisation.findByPk(orgId, {
      attributes: ["id", "smtp_settings"],
    });
    const orgConfig = parseOrganisationSmtpSettings(org?.smtp_settings);
    if (isSmtpConfigComplete(orgConfig)) {
      return orgConfig;
    }
  }

  return getPlatformSmtpConfig();
}

function buildNodemailerTransportOptions(config) {
  const auth = { user: config.user, pass: config.pass };

  if (config.host) {
    const port = Number(config.port) || 587;
    const secure =
      config.secure === true ||
      config.secure === "true" ||
      port === 465;
    return { host: config.host, port, secure, auth };
  }

  return {
    service: config.service || "gmail",
    auth,
  };
}

function cacheKeyForConfig(config) {
  return JSON.stringify({
    source: config.source,
    host: config.host,
    port: config.port,
    secure: config.secure,
    service: config.service,
    user: config.user,
    from: config.from,
  });
}

function getTransporterForConfig(config) {
  const key = cacheKeyForConfig(config);
  if (transportCache.has(key)) {
    return transportCache.get(key);
  }
  const transport = nodemailer.createTransport(buildNodemailerTransportOptions(config));
  transportCache.set(key, transport);
  return transport;
}

export function isMailConfigured(organisationId = null) {
  return resolveSmtpConfig(organisationId).then((c) => isSmtpConfigComplete(c));
}

/** Mask secrets for API responses. */
export function maskSmtpConfigForClient(config, { hasPassword = false } = {}) {
  if (!config) return null;
  return {
    source: config.source,
    enabled: config.enabled !== false,
    host: config.host || "",
    port: config.port != null ? String(config.port) : "",
    secure: config.secure === true || config.secure === "true",
    service: config.service || "",
    user: config.user || "",
    from: config.from || config.user || "",
    hasPassword: hasPassword || Boolean(config.pass),
    password: "",
  };
}

/**
 * Send email using org SMTP when set, else platform superadmin SMTP.
 */
export async function sendTransactionalEmail({
  to,
  subject,
  html,
  text,
  organisationId = null,
}) {
  const config = await resolveSmtpConfig(organisationId);

  if (!isSmtpConfigComplete(config)) {
    console.warn(
      `[mail] No SMTP for org=${organisationId ?? "n/a"} — set organisation SMTP or platform EMAIL_USER/EMAIL_PASS`,
    );
    return { sent: false, reason: "mail_not_configured", usedSource: null };
  }

  const recipient = String(to || "").trim();
  if (!recipient) {
    return { sent: false, reason: "missing_recipient", usedSource: config.source };
  }

  const from = String(config.from || config.user).trim();

  try {
    const transport = getTransporterForConfig(config);
    const info = await transport.sendMail({
      from,
      to: recipient,
      subject: String(subject || "").trim() || "EPiC Notification",
      html,
      text,
    });
    return {
      sent: true,
      messageId: info?.messageId,
      usedSource: config.source,
    };
  } catch (err) {
    console.error("[mail] send failed:", {
      organisationId,
      usedSource: config.source,
      to: recipient,
      error: err?.message,
      code: err?.code,
    });
    return {
      sent: false,
      reason: "send_failed",
      error: err?.message || "Email delivery failed",
      usedSource: config.source,
    };
  }
}

export async function verifyMailTransport(organisationId = null) {
  const config = await resolveSmtpConfig(organisationId);
  if (!isSmtpConfigComplete(config)) {
    console.warn("[mail] Transport not configured");
    return { ok: false, source: null };
  }
  try {
    const transport = getTransporterForConfig(config);
    await transport.verify();
    console.log(`[mail] SMTP ready (${config.source}${organisationId ? `, org=${organisationId}` : ""})`);
    return { ok: true, source: config.source };
  } catch (err) {
    console.error(`[mail] SMTP verify failed (${config.source}):`, err.message);
    return { ok: false, source: config.source, error: err.message };
  }
}
