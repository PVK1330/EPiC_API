/**
 * whatsappReminder.service.js — EPiC Platform
 *
 * Thin WhatsApp delivery layer.  When TWILIO_WHATSAPP_FROM is set in the
 * environment the service uses the Twilio API to send a WhatsApp message.
 * When the variable is absent the service logs the would-be message and
 * returns { sent: false, reason: "not_configured" } — no code changes are
 * needed to enable the feature later.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Required .env variables (Twilio path):
 *
 *   TWILIO_ACCOUNT_SID    = ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *   TWILIO_AUTH_TOKEN     = your_auth_token
 *   TWILIO_WHATSAPP_FROM  = whatsapp:+14155238886   ← Twilio sandbox / approved number
 *
 * The recipient phone number must be in E.164 format, e.g. "+447700900123".
 * Twilio automatically prepends the "whatsapp:" URI scheme for the To field.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Usage:
 *
 *   import { sendWhatsAppReminder } from '../services/whatsappReminder.service.js';
 *
 *   const result = await sendWhatsAppReminder('+447700900123', 'Please respond …');
 *   // result.sent  → true | false
 *   // result.sid   → Twilio message SID (when sent)
 *   // result.reason → 'not_configured' | 'invalid_phone' | 'send_failed' (when not sent)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Installing Twilio (when ready to enable):
 *
 *   npm install twilio
 *
 * Until it is installed the dynamic import below will throw; this is caught
 * and returned as { sent: false, reason: 'twilio_not_installed' } so the
 * calling code (reminder.job.js) is never blocked.
 */

import logger from "../utils/logger.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/**
 * Normalise a phone number to E.164 format (best-effort).
 * Strips spaces, dashes, and parentheses.  Returns null if the result does
 * not match E.164 so the caller can skip the send gracefully.
 *
 * @param {string} raw
 * @returns {string|null}
 */
function normalizePhone(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[\s\-().]/g, "");
  return E164_REGEX.test(cleaned) ? cleaned : null;
}

/**
 * Lazy-load the Twilio SDK.  The dynamic import means the service file can
 * be loaded even when `twilio` is not yet installed — the error surfaces only
 * when an actual send is attempted with TWILIO_WHATSAPP_FROM set.
 *
 * @returns {Promise<object>} Initialised Twilio REST client.
 */
async function getTwilioClient() {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken  = String(process.env.TWILIO_AUTH_TOKEN  || "").trim();

  if (!accountSid || !authToken) {
    throw new Error(
      "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must both be set to use WhatsApp delivery",
    );
  }

  // Dynamic import keeps the optional dependency truly optional.
  const twilio = await import("twilio").then((m) => m.default ?? m);
  return twilio(accountSid, authToken);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a WhatsApp message to `phone` with body `message`.
 *
 * The function is intentionally forgiving:
 *  - If TWILIO_WHATSAPP_FROM is absent the message is logged and the call
 *    returns { sent: false, reason: "not_configured" }.
 *  - If the phone number is malformed it returns { sent: false, reason: "invalid_phone" }.
 *  - If the Twilio SDK is not installed it returns { sent: false, reason: "twilio_not_installed" }.
 *  - Any other Twilio or network error returns { sent: false, reason: "send_failed", error }.
 *
 * @param {string} phone    - Recipient in E.164 format, e.g. "+447700900123".
 * @param {string} message  - Plain-text body of the WhatsApp message.
 * @returns {Promise<{
 *   sent: boolean,
 *   sid?: string,
 *   reason?: string,
 *   error?: string
 * }>}
 */
export async function sendWhatsAppReminder(phone, message) {
  const fromNumber = String(process.env.TWILIO_WHATSAPP_FROM || "").trim();

  // ── Stub path: provider not configured ──────────────────────────────────
  if (!fromNumber) {
    logger.info(
      { phone, messagePreview: String(message || "").slice(0, 80) },
      "[whatsapp] WhatsApp not configured — would send: " + String(message || ""),
    );
    return { sent: false, reason: "not_configured" };
  }

  // ── Validate recipient ───────────────────────────────────────────────────
  const to = normalizePhone(phone);
  if (!to) {
    logger.warn(
      { rawPhone: phone },
      "[whatsapp] Invalid phone number format — WhatsApp send skipped",
    );
    return { sent: false, reason: "invalid_phone" };
  }

  // Twilio WhatsApp requires the "whatsapp:" URI scheme prefix on both
  // the From and To numbers.
  const toWhatsApp   = to.startsWith("whatsapp:") ? to   : `whatsapp:${to}`;
  const fromWhatsApp = fromNumber.startsWith("whatsapp:") ? fromNumber : `whatsapp:${fromNumber}`;

  // ── Live send via Twilio ─────────────────────────────────────────────────
  let client;
  try {
    client = await getTwilioClient();
  } catch (err) {
    if (err.code === "ERR_MODULE_NOT_FOUND" || err.message?.includes("Cannot find module")) {
      logger.error(
        { err },
        "[whatsapp] Twilio SDK not installed — run `npm install twilio` to enable WhatsApp delivery",
      );
      return { sent: false, reason: "twilio_not_installed", error: err.message };
    }
    logger.error({ err }, "[whatsapp] Failed to initialise Twilio client");
    return { sent: false, reason: "send_failed", error: err.message };
  }

  try {
    const msg = await client.messages.create({
      from: fromWhatsApp,
      to:   toWhatsApp,
      body: String(message || "").trim(),
    });

    logger.info(
      { sid: msg.sid, to: toWhatsApp, status: msg.status },
      "[whatsapp] WhatsApp message sent",
    );

    return { sent: true, sid: msg.sid, status: msg.status };
  } catch (err) {
    logger.error(
      { err, to: toWhatsApp, twilioCode: err.code },
      "[whatsapp] Failed to send WhatsApp message",
    );
    return { sent: false, reason: "send_failed", error: err.message };
  }
}
