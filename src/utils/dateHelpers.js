/**
 * Server-timezone-aware date helpers.
 *
 * process.env.TZ is set to 'Asia/Kolkata' at startup, so all local Date
 * methods (getFullYear, getMonth, getDate, getHours …) operate in IST.
 *
 * IMPORTANT: Date.toISOString() ALWAYS returns UTC regardless of TZ — never
 * use it to derive the "local today" string for DATEONLY comparisons.
 */

/** YYYY-MM-DD string in the server's local timezone (IST). */
export function localDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** YYYY-MM-DD string for `today + N days` in local timezone. */
export function localDateAfterDays(days, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

/** Midnight of today in local timezone (for Sequelize timestamp comparisons). */
export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Date object representing `now + hours` (for timestamp window queries). */
export function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}
