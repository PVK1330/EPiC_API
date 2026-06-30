/**
 * gdprPolicy.js
 * Shared retention-policy constants and helpers for GDPR compliance.
 *
 * UK immigration law (Immigration Rules, Sponsor Guidance) mandates that sponsors
 * retain records for the duration of the sponsored worker's employment PLUS a
 * further period after the CoS / permission expires. The UKVI guidance commonly
 * cited by practitioners is 7 years (2555 days). The default here follows that
 * interpretation; override via DATA_RETENTION_DAYS env var if your legal counsel
 * specifies a different period.
 *
 * Usage:
 *   import { DATA_RETENTION_DAYS, getPurgeDate, isExpiredForRetention } from '../utils/gdprPolicy.js';
 *
 *   if (isExpiredForRetention(record.createdAt)) {
 *     await record.destroy({ force: true });
 *   }
 */

/**
 * Default retention period: 7 years = 365.25 * 7 ≈ 2556 days.
 * Override with DATA_RETENTION_DAYS environment variable (integer, days).
 *
 * References:
 *  - UK GDPR Article 5(1)(e): storage limitation
 *  - UKVI Sponsor Guidance: Chapter 9 — record-keeping obligations
 *  - Immigration Rules Part 6A / Appendix Skilled Worker
 */
export const DATA_RETENTION_DAYS = (() => {
  const override = parseInt(process.env.DATA_RETENTION_DAYS, 10);
  if (Number.isFinite(override) && override > 0) return override;
  return 2555; // 7 years (365 * 7 = 2555)
})();

/**
 * Calculate the date on which a record created at `createdAt` becomes eligible
 * for purging under the current retention policy.
 *
 * @param {Date|string|number} createdAt - Record creation timestamp.
 * @returns {Date} The date after which the record may be deleted.
 */
export function getPurgeDate(createdAt) {
  const created = new Date(createdAt);
  const purgeDate = new Date(created.getTime() + DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return purgeDate;
}

/**
 * Check whether a record has passed its retention deadline.
 *
 * @param {Date|string|number} createdAt - Record creation timestamp.
 * @param {Date} [asOf=new Date()] - Reference "now" (injectable for testing).
 * @returns {boolean} true if the record is past its retention cutoff.
 */
export function isExpiredForRetention(createdAt, asOf = new Date()) {
  return getPurgeDate(createdAt) < asOf;
}

/**
 * Calculate the retention cutoff date (i.e. records created BEFORE this date
 * are eligible for purging).
 *
 * @param {number} [retentionDays=DATA_RETENTION_DAYS]
 * @param {Date}   [asOf=new Date()]
 * @returns {Date}
 */
export function getRetentionCutoff(retentionDays = DATA_RETENTION_DAYS, asOf = new Date()) {
  return new Date(asOf.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

/**
 * Format a retention summary for a given createdAt date (useful in reports).
 *
 * @param {Date|string|number} createdAt
 * @returns {{ createdAt: string, purgeDate: string, retentionDays: number, expired: boolean }}
 */
export function retentionSummary(createdAt) {
  const purgeDate = getPurgeDate(createdAt);
  return {
    createdAt: new Date(createdAt).toISOString(),
    purgeDate: purgeDate.toISOString(),
    retentionDays: DATA_RETENTION_DAYS,
    expired: purgeDate < new Date(),
  };
}

export default { DATA_RETENTION_DAYS, getPurgeDate, isExpiredForRetention, getRetentionCutoff, retentionSummary };
