/**
 * Phase 2 UAT (3.1 / 3.2) — visa expiry settings and checks.
 *
 * - Visa expiry alert window: how many days before a client's visa expires an
 *   alert is raised (dashboard "Visa Alerts", client list counter). Stored per
 *   firm in sla_settings.visa_expiry_alert_days; default 90.
 * - Target submission date warning: in-country applications (e.g. ILR) must be
 *   made before current leave expires, so a target date AFTER the visa expiry
 *   is flagged (never blocked — staff may know better).
 */
import logger from "../utils/logger.js";

export const DEFAULT_VISA_EXPIRY_ALERT_DAYS = 90;
export const MIN_VISA_EXPIRY_ALERT_DAYS = 1;
export const MAX_VISA_EXPIRY_ALERT_DAYS = 365;

/** Read the firm's alert window (days). Falls back to the default on any problem. */
export async function getVisaExpiryAlertDays(tenantDb) {
  try {
    const row = await tenantDb?.SlaSetting?.findOne({ order: [["id", "ASC"]] });
    const days = parseInt(row?.visa_expiry_alert_days, 10);
    if (Number.isFinite(days) && days >= MIN_VISA_EXPIRY_ALERT_DAYS && days <= MAX_VISA_EXPIRY_ALERT_DAYS) {
      return days;
    }
  } catch (err) {
    logger.warn({ err }, "getVisaExpiryAlertDays: falling back to default");
  }
  return DEFAULT_VISA_EXPIRY_ALERT_DAYS;
}

/** Validate + save the alert window. Returns the saved value. Throws a 400-style error on bad input. */
export async function setVisaExpiryAlertDays(tenantDb, value) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < MIN_VISA_EXPIRY_ALERT_DAYS || days > MAX_VISA_EXPIRY_ALERT_DAYS) {
    const err = new Error(
      `Visa expiry alert window must be a whole number of days between ${MIN_VISA_EXPIRY_ALERT_DAYS} and ${MAX_VISA_EXPIRY_ALERT_DAYS}.`,
    );
    err.statusCode = 400;
    throw err;
  }
  let row = await tenantDb.SlaSetting.findOne({ order: [["id", "ASC"]] });
  if (!row) row = await tenantDb.SlaSetting.create({ id: 1 });
  await row.update({ visa_expiry_alert_days: days });
  return days;
}

/** Date-only (YYYY-MM-DD) form of a date-ish value, or null. */
function toDateOnly(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Warning text when the target submission date falls after the visa expiry,
 * else null. Compares calendar dates only.
 */
export function targetDateVisaWarning(targetSubmissionDate, visaExpiryDate) {
  const target = toDateOnly(targetSubmissionDate);
  const expiry = toDateOnly(visaExpiryDate);
  if (!target || !expiry || target <= expiry) return null;
  const fmt = (iso) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `The target submission date (${fmt(target)}) is after the client's visa expiry (${fmt(expiry)}). In-country applications usually have to be made before current leave expires.`;
}

/**
 * The visa expiry that applies to a case: the case's own date if set, otherwise
 * the client's current-visa expiry from their application.
 */
export async function resolveCaseVisaExpiry(tenantDb, { candidateId, caseVisaEndDate = null, transaction } = {}) {
  if (caseVisaEndDate) return caseVisaEndDate;
  if (!candidateId || !tenantDb?.CandidateApplication) return null;
  try {
    const app = await tenantDb.CandidateApplication.findOne({
      where: { userId: candidateId },
      attributes: ["visaEndDate"],
      transaction,
    });
    return app?.visaEndDate || null;
  } catch (err) {
    logger.warn({ err, candidateId }, "resolveCaseVisaExpiry failed");
    return null;
  }
}

/** Convenience: warnings[] for a case create/update/reschedule response. */
export async function buildTargetDateWarnings(tenantDb, { candidateId, caseVisaEndDate, targetSubmissionDate, transaction } = {}) {
  const expiry = await resolveCaseVisaExpiry(tenantDb, { candidateId, caseVisaEndDate, transaction });
  const warning = targetDateVisaWarning(targetSubmissionDate, expiry);
  return warning ? [warning] : [];
}
