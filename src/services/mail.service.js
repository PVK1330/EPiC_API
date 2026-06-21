import dns from "dns/promises";
import nodemailer from "nodemailer";
import platformDb from "../models/index.js";
import { getSettingsByNamespace } from "./settings.service.js";
import { generateFailureNoticeTemplate, generateDispatchReceiptTemplate } from "../utils/emailTemplates.js";
import { wrapEpicEmail } from "../utils/epicEmailLayout.js";
import {
  getOrganisationEmailBranding,
  isFullHtmlDocument,
  textToInnerHtml,
} from "../utils/emailBranding.js";
import logger from "../utils/logger.js";

const transportCache = new Map();
const MASK = "••••••••";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

/** Basic format check before SMTP send. */
export function isValidEmailAddress(email) {
  const s = String(email || "").trim();
  if (!s || s.length > 254) return false;
  return EMAIL_REGEX.test(s);
}

const KNOWN_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
]);

/** Verify the recipient domain has MX records (can receive mail). Best-effort — DNS errors do not block send. */
export async function recipientDomainHasMx(email) {
  const domain = String(email || "").split("@")[1]?.trim().toLowerCase();
  if (!domain) return false;
  if (KNOWN_MAIL_DOMAINS.has(domain)) return true;

  try {
    const records = await dns.resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch (err) {
    if (err?.code === "ENOTFOUND" || err?.code === "ENODATA") {
      return false;
    }
    logger.warn({ err, domain }, `[mail] MX lookup inconclusive for ${domain}, allowing send`);
    return true;
  }
}

/** Interpret nodemailer result — SMTP "success" can still reject recipients. */
function interpretSendMailResult(info, recipient) {
  const target = String(recipient || "").trim().toLowerCase();
  const rejected = (info?.rejected || []).map((a) => String(a).toLowerCase());
  const accepted = (info?.accepted || []).map((a) => String(a).toLowerCase());

  if (rejected.length > 0) {
    return {
      ok: false,
      error: `SMTP rejected recipient(s): ${rejected.join(", ")}`,
      response: info?.response,
    };
  }

  if (accepted.length > 0 && !accepted.includes(target)) {
    return {
      ok: false,
      error: `SMTP did not accept ${target}. Server response: ${info?.response || "unknown"}`,
      response: info?.response,
    };
  }

  const response = String(info?.response || "");
  if (/^[45]\d{2}\s/.test(response)) {
    return { ok: false, error: response, response };
  }

  return {
    ok: true,
    messageId: info?.messageId,
    response: info?.response,
    accepted,
    rejected,
  };
}

/** Gmail app passwords are 16 chars; strip spaces if pasted with gaps. */
function normalizeSmtpPassword(pass) {
  const raw = String(pass || "").trim();
  if (!raw || raw === MASK) return "";
  return raw.replace(/\s+/g, "");
}

/**
 * Gmail treats self-sent mail as Sent-folder only. Alias forces inbox delivery for admin notices.
 * e.g. user@gmail.com → user+epicadmin@gmail.com (unchanged if already aliased or non-Gmail).
 */
export function forceInboxAlias(email) {
  const trimmed = String(email || "").trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();

  if (domain !== "gmail.com" || local.includes("+")) {
    return trimmed;
  }

  return `${local}+epicadmin@gmail.com`;
}

/** Compare mailbox ignoring +alias (user+tag@gmail.com === user@gmail.com). */
function sameMailbox(a, b) {
  const key = (email) => {
    const s = String(email || "").trim().toLowerCase();
    const at = s.lastIndexOf("@");
    if (at <= 0) return s;
    const local = s.slice(0, at).split("+")[0];
    return `${local}@${s.slice(at + 1)}`;
  };
  return key(a) === key(b);
}

/** Clear cached transporters after connectivity SMTP is updated. */
export function clearMailTransportCache() {
  transportCache.clear();
}

/** Platform SMTP from environment variables (fallback). */
export function getPlatformSmtpConfigFromEnv() {
  const user = String(process.env.EMAIL_USER || "").trim();
  const pass = normalizeSmtpPassword(process.env.EMAIL_PASS);
  if (!user || !pass) return null;

  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : null;

  return {
    source: "platform_env",
    enabled: true,
    host: process.env.SMTP_HOST || null,
    port,
    secure:
      process.env.SMTP_SECURE === true ||
      process.env.SMTP_SECURE === "true" ||
      port === 465,
    service: process.env.EMAIL_SERVICE || "gmail",
    user,
    pass,
    from: String(process.env.EMAIL_FROM || user).trim(),
  };
}

/**
 * Platform SMTP from Superadmin → Settings → Connectivity (platform_settings DB),
 * falling back to .env when DB credentials are incomplete.
 */
export async function loadPlatformSmtpConfig() {
  try {
    const smtpRaw = await getSettingsByNamespace("smtp");
    const user = String(smtpRaw.username || "").trim();
    const pass = normalizeSmtpPassword(smtpRaw.password);

    if (user && pass) {
      const host = String(smtpRaw.host || "").trim();
      const port = parseInt(smtpRaw.port ?? "587", 10) || 587;
      const encryption = String(smtpRaw.encryption || "tls").toLowerCase();
      const secure = encryption === "ssl" || port === 465;

      let replyTo = null;
      try {
        const identity = await getSettingsByNamespace(null);
        const supportEmail = String(identity?.support_email || "").trim();
        if (supportEmail && supportEmail.toLowerCase() !== user.toLowerCase()) {
          replyTo = supportEmail;
        }
      } catch {
        // non-fatal
      }

      return {
        source: "platform_db",
        enabled: true,
        host: host || null,
        port,
        secure,
        encryption,
        service: host ? null : process.env.EMAIL_SERVICE || "gmail",
        user,
        pass,
        from: user,
        replyTo,
      };
    }
  } catch (err) {
    logger.error({ err }, "[mail] Failed to load platform SMTP from settings");
  }

  return getPlatformSmtpConfigFromEnv();
}

/** @deprecated Use loadPlatformSmtpConfig() — sync env-only helper kept for compatibility. */
export function getPlatformSmtpConfig() {
  return getPlatformSmtpConfigFromEnv();
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
 * Organisation custom SMTP if configured; otherwise platform SMTP (DB then .env).
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

  return loadPlatformSmtpConfig();
}

function buildNodemailerTransportOptions(config) {
  const auth = { user: config.user, pass: config.pass };

  if (config.host) {
    const port = Number(config.port) || 587;
    const secure =
      config.secure === true ||
      config.secure === "true" ||
      port === 465;
    const options = { host: config.host, port, secure, auth };
    if (!secure && port === 587) {
      options.requireTLS = true;
    }
    return options;
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
    pass: config.pass,
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

/** Sanitise a display name for the From header (strip quotes/control chars). */
function sanitizeFromName(name) {
  return String(name || "")
    .replace(/["\\\r\n]/g, "")
    .trim();
}

/**
 * Build the From header. The display name is the sending ORGANISATION's name
 * (per-tenant) so recipients see their own firm, not a hardcoded "EPiC".
 */
function formatFromAddress(config, fromName) {
  const fromUser = String(config.user || config.from || "").trim();
  const display = sanitizeFromName(fromName) || "EPiC";
  return fromUser.includes("@") ? `"${display}" <${fromUser}>` : fromUser;
}

/** Normalise nodemailer attachment objects. */
function normalizeMailAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return undefined;
  return attachments
    .filter((a) => a && (a.content || a.path))
    .map((a) => ({
      filename: String(a.filename || "attachment").trim(),
      content: a.content,
      path: a.path,
      contentType: a.contentType || undefined,
    }));
}

/** Low-level send — no failure notification (avoids loops). */
async function sendMailWithConfig(config, { to, subject, html, text, replyTo, attachments, fromName }) {
  const transport = getTransporterForConfig(config);
  const from = formatFromAddress(config, fromName);
  const sender = String(config.user || "").trim();
  const reply = replyTo ?? (config.replyTo ? String(config.replyTo).trim() : undefined);
  const mailAttachments = normalizeMailAttachments(attachments);

  return transport.sendMail({
    from,
    ...(sender ? { sender } : {}),
    ...(reply ? { replyTo: reply } : {}),
    to: String(to || "").trim(),
    subject: String(subject || "").trim() || "EPiC Notification",
    html,
    text,
    ...(mailAttachments?.length ? { attachments: mailAttachments } : {}),
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildFailureNoticeContent({ recipient, subject, error, reason, context, smtpFrom, branding = {} }) {
  const attemptedSubject = String(subject || "EPiC notification").trim();
  const notificationSubject = `EPiC Notification: ${attemptedSubject}`;
  const ctx = String(context || "").trim();
  const errMsg = String(error || reason || "Delivery failed").trim();
  const fromLine = String(smtpFrom || "").trim();
  const toLine = String(recipient || "").trim() || "(empty)";
  const sentAt = new Date().toUTCString();

  const recipientSafe = escapeHtml(toLine);
  const subjectSafe = escapeHtml(attemptedSubject);
  const fromSafe = escapeHtml(fromLine);
  const ctxSafe = escapeHtml(ctx);
  const errSafe = escapeHtml(errMsg);

  const bounceLine = `Your message wasn't delivered to ${toLine} because the address couldn't be found, or is unable to receive mail.`;

  const text = [
    "Address not found",
    "",
    bounceLine,
    "",
    fromLine ? `from: ${fromLine}` : null,
    `to: ${toLine}`,
    `date: ${sentAt}`,
    `subject: ${notificationSubject}`,
    ctx ? `context: ${ctx}` : null,
    `error: ${errMsg}`,
    "",
    "LEARN MORE: Correct the recipient email in EPiC and try again.",
  ]
    .filter(Boolean)
    .join("\n");

  const html = generateFailureNoticeTemplate({
    reasonLabel: bounceLine,
    recipientSafe,
    subjectSafe: notificationSubject,
    ctxSafe,
    errSafe,
    branding,
  });

  return { text, html, notificationSubject };
}

/**
 * Notify the SMTP account owner that a message could not be delivered.
 */
function buildDispatchReceiptContent({ recipient, subject, messageId, response, context, branding = {} }) {
  const ctx = String(context || "").trim();
  const text = [
    "EPiC — email dispatch confirmation",
    "",
    `Recipient: ${recipient}`,
    `Subject: ${subject}`,
    ctx ? `Context: ${ctx}` : null,
    messageId ? `Message-ID: ${messageId}` : null,
    response ? `SMTP response: ${response}` : null,
    "",
    "The message was accepted by your SMTP server. If the recipient does not see it, ask them to check spam/promotions.",
    "You receive this copy because you are the configured SMTP account.",
  ]
    .filter(Boolean)
    .join("\n");

  const html = generateDispatchReceiptTemplate({
    recipient,
    subject,
    ctx,
    messageId,
    response,
    branding,
  });

  return { text, html };
}

/** Send dispatch receipt to SMTP owner (separate from failure notice). */
async function notifySmtpOwnerOfDispatch(config, details) {
  const owner = String(config?.user || "").trim();
  if (!owner || !isValidEmailAddress(owner)) {
    return { notified: false, reason: "no_smtp_owner" };
  }

  const recipient = String(details.recipient || "").trim();
  if (sameMailbox(recipient, owner)) {
    return { notified: false, reason: "recipient_is_owner" };
  }

  const branding = await getOrganisationEmailBranding(null);
  const { text, html } = buildDispatchReceiptContent({ ...details, branding });
  const subject = `[${branding.orgName}] Dispatched — ${String(details.subject || "notification").slice(0, 80)}`;

  const ownerRecipient = forceInboxAlias(owner);

  try {
    await sendMailWithConfig(config, {
      to: ownerRecipient,
      subject,
      html,
      text,
      fromName: branding.orgName,
    });
    logger.info({ owner, ownerRecipient }, "[mail] Dispatch receipt sent to SMTP owner");
    return { notified: true, owner, ownerRecipient };
  } catch (err) {
    logger.error({ err, owner, ownerRecipient }, "[mail] Could not send dispatch receipt");
    return { notified: false, reason: "owner_receipt_failed", error: err.message };
  }
}

async function notifySmtpOwnerOfFailure(config, details) {
  const owner = String(config?.user || "").trim();
  if (!owner || !isValidEmailAddress(owner)) {
    return { notified: false, reason: "no_smtp_owner" };
  }

  const recipient = String(details.recipient || "").trim();
  if (sameMailbox(recipient, owner)) {
    return { notified: false, reason: "recipient_is_owner" };
  }

  const ownerRecipient = forceInboxAlias(owner);
  const branding = await getOrganisationEmailBranding(null);
  const { text, html, notificationSubject } = buildFailureNoticeContent({
    ...details,
    smtpFrom: owner,
    branding,
  });

  try {
    await sendMailWithConfig(config, {
      to: ownerRecipient,
      subject: notificationSubject,
      html,
      text,
      fromName: branding.orgName,
    });
    logger.info({ owner, ownerRecipient }, "[mail] Delivery failure notice sent to SMTP owner");
    return { notified: true, owner, ownerRecipient };
  } catch (err) {
    logger.error({ err, owner, ownerRecipient }, "[mail] Could not notify SMTP owner");
    return { notified: false, reason: "owner_notify_failed", error: err.message };
  }
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
 * On invalid recipient or SMTP failure, notifies the SMTP account owner by default.
 */
/** Resolve To address — Gmail self-send goes to Sent unless aliased. */
function resolveDeliveryRecipient(recipient, config) {
  const to = String(recipient || "").trim();
  const owner = String(config?.user || "").trim();
  if (to && owner && sameMailbox(to, owner)) {
    return forceInboxAlias(to);
  }
  return to;
}

export async function sendTransactionalEmail({
  to,
  subject,
  html,
  text,
  attachments = null,
  organisationId = null,
  forcePlatformSmtp = false,
  notifyOwnerOnFailure = true,
  failureContext = "",
  brandingOverride = null,
}) {
  const config = forcePlatformSmtp
    ? await loadPlatformSmtpConfig()
    : await resolveSmtpConfig(organisationId);

  if (!isSmtpConfigComplete(config)) {
    logger.warn(
      { organisationId: organisationId ?? "n/a" },
      "[mail] No SMTP configured — set Superadmin Connectivity SMTP or EMAIL_USER/EMAIL_PASS in .env",
    );
    return { sent: false, reason: "mail_not_configured", usedSource: null };
  }

  const recipient = resolveDeliveryRecipient(to, config);
  const mailSubject = String(subject || "").trim() || "EPiC Notification";
  const failDetails = {
    recipient: String(to || "").trim(),
    subject: mailSubject,
    context: failureContext,
  };

  if (!recipient) {
    let ownerNotified = false;
    if (notifyOwnerOnFailure) {
      const n = await notifySmtpOwnerOfFailure(config, {
        ...failDetails,
        reason: "missing_recipient",
        error: "No recipient address was provided",
      });
      ownerNotified = n.notified;
    }
    return {
      sent: false,
      reason: "missing_recipient",
      usedSource: config.source,
      ownerNotified,
    };
  }

  if (!isValidEmailAddress(recipient)) {
    const error = "Invalid email address format";
    let ownerNotified = false;
    if (notifyOwnerOnFailure) {
      const n = await notifySmtpOwnerOfFailure(config, {
        ...failDetails,
        reason: "invalid_recipient",
        error,
      });
      ownerNotified = n.notified;
    }
    logger.warn({ recipient }, "[mail] invalid recipient");
    return {
      sent: false,
      reason: "invalid_recipient",
      error,
      usedSource: config.source,
      ownerNotified,
    };
  }

  const hasMx = await recipientDomainHasMx(recipient);
  if (!hasMx) {
    const error = `Recipient domain has no MX records (${recipient.split("@")[1]})`;
    let ownerNotified = false;
    if (notifyOwnerOnFailure) {
      const n = await notifySmtpOwnerOfFailure(config, {
        ...failDetails,
        reason: "invalid_recipient",
        error,
      });
      ownerNotified = n.notified;
    }
    return {
      sent: false,
      reason: "invalid_recipient",
      error,
      usedSource: config.source,
      ownerNotified,
    };
  }

  // Resolve per-tenant branding: drives the From display-name, reply-to, and
  // (when the body isn't already framed) the single branded visual shell.
  const branding =
    brandingOverride || (await getOrganisationEmailBranding(forcePlatformSmtp ? null : organisationId));
  const fromName = branding.orgName;
  const brandReplyTo =
    branding.replyTo && !sameMailbox(branding.replyTo, config.user) ? branding.replyTo : undefined;

  // ONE template everywhere: callers that pass raw/partial HTML (e.g. "<p>..</p>")
  // or only plain text get wrapped in the branded shell here. Full HTML documents
  // produced by the template helpers are already framed and pass through untouched.
  let finalHtml = html;
  if (!isFullHtmlDocument(html)) {
    const inner =
      typeof html === "string" && html.trim() ? html : textToInnerHtml(text || "");
    if (inner) {
      finalHtml = wrapEpicEmail({
        branding,
        pageTitle: mailSubject,
        bodyHtml: inner,
      });
    }
  }

  try {
    const info = await sendMailWithConfig(config, {
      to: recipient,
      subject: mailSubject,
      html: finalHtml,
      text,
      attachments,
      fromName,
      replyTo: brandReplyTo,
    });

    const parsed = interpretSendMailResult(info, recipient);
    if (!parsed.ok) {
      let ownerNotified = false;
      if (notifyOwnerOnFailure) {
        const n = await notifySmtpOwnerOfFailure(config, {
          ...failDetails,
          reason: "send_failed",
          error: parsed.error,
        });
        ownerNotified = n.notified;
      }
      return {
        sent: false,
        reason: "send_failed",
        error: parsed.error,
        usedSource: config.source,
        ownerNotified,
        smtpResponse: parsed.response,
      };
    }

    return {
      sent: true,
      deliveryStatus: "accepted_by_smtp",
      messageId: parsed.messageId,
      usedSource: config.source,
      smtpResponse: parsed.response,
      deliveryRecipient: recipient,
    };
  } catch (err) {
    const error = err?.message || "Email delivery failed";
    logger.error({ err, organisationId, recipient: to, usedSource: config.source, code: err?.code }, "[mail] send failed");

    let ownerNotified = false;
    if (notifyOwnerOnFailure) {
      const n = await notifySmtpOwnerOfFailure(config, {
        ...failDetails,
        reason: "send_failed",
        error,
      });
      ownerNotified = n.notified;
    }

    return {
      sent: false,
      reason: "send_failed",
      error,
      usedSource: config.source,
      ownerNotified,
    };
  }
}

/**
 * Welcome email for a new organisation admin (always uses platform Connectivity SMTP).
 */
export async function sendOrganisationAdminWelcomeEmail({
  admin,
  plainPassword,
  organisationId,
  loginUrl,
}) {
  const url =
    loginUrl ||
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    "http://localhost:5173";
  // The url here is from `resolveOrganisationLoginUrl` if passed.
  // Actually, wait, `superadminOrganisation.controller.js` does NOT pass loginUrl!
  // It calls: sendOrganisationAdminWelcomeEmail({ admin, plainPassword, organisationId: org.id })
  // Let's resolve both here!
  let orgUrl = url;
  let mainUrl = url;
  
  if (organisationId) {
    const fallbackBase = process.env.FRONTEND_URL?.split(",")[0]?.trim() || "http://localhost:5173";
    mainUrl = `${fallbackBase.replace(/\/$/, "")}/login`;
    
    // Attempt to get slug
    const org = await platformDb.Organisation.findByPk(organisationId, { attributes: ["slug"] });
    if (org?.slug) {
      const { buildTenantFrontendUrls } = await import('../utils/organisationHost.js');
      const { subdomain } = buildTenantFrontendUrls(org.slug);
      orgUrl = `${subdomain.replace(/\/$/, "")}/login`;
    } else {
      orgUrl = mainUrl;
    }
  }

  const firstName = String(admin?.first_name || "Admin").trim();
  const email = String(admin?.email || "").trim();
  const plain = String(plainPassword || "").trim();

  // Resolve the org's branding so the welcome shows the org logo/name even though
  // it is sent via platform SMTP (the org may not have its own SMTP yet).
  const branding = await getOrganisationEmailBranding(organisationId);

  // Import the standard template generator
  const { generateAdminCredentialsTemplate } = await import('../utils/emailTemplates.js');
  const htmlContent = generateAdminCredentialsTemplate(email, plain, orgUrl, mainUrl, branding);

  return sendTransactionalEmail({
    to: email,
    subject: `Welcome to ${branding.orgName} — Your Admin Credentials`,
    html: htmlContent,
    text: `Hi ${firstName},\n\nYour organisation administrator account is ready.\n\nEmail: ${email}\nTemporary password: ${plain}\n\nLog in: ${orgUrl}\nMain Portal: ${mainUrl}\n\nPlease change your password after your first login.`,
    forcePlatformSmtp: true,
    organisationId: null,
    brandingOverride: branding,
    failureContext: `Organisation admin welcome email (org #${organisationId ?? "new"})`,
  });
}

export async function verifyMailTransport(organisationId = null) {
  const config = await resolveSmtpConfig(organisationId);
  if (!isSmtpConfigComplete(config)) {
    logger.warn("[mail] Transport not configured");
    return { ok: false, source: null };
  }
  try {
    const transport = getTransporterForConfig(config);
    await transport.verify();
    logger.info(
      { source: config.source, organisationId },
      "[mail] SMTP ready",
    );
    return { ok: true, source: config.source };
  } catch (err) {
    logger.error({ err, source: config.source }, "[mail] SMTP verify failed");
    return { ok: false, source: config.source, error: err.message };
  }
}
