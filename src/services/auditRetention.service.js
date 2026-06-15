/**
 * Audit Retention Service
 *
 * The append-only audit tables grow without bound — every licence review action
 * writes a row to `licence_application_audits`, and every compliance review action
 * writes a row to `compliance_review_history`. Neither is ever updated or deleted by
 * the application, so over time they degrade query performance and inflate backups.
 *
 * `purgeOldAuditRecords(tenantDb, opts)` deletes rows older than a retention cutoff
 * from BOTH tables for a single tenant. It is intentionally reusable and side-effect
 * free beyond the deletes: it takes a passed-in `tenantDb` (NOT a hardcoded global),
 * guards for missing models, and returns a count summary.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SCHEDULING
 * ────────────────────────────────────────────────────────────────────────────
 * This file deliberately does NOT register a cron job, because audit retention is
 * a per-tenant operation and the existing cron registry (src/jobs/index.js) fires
 * zero-argument platform-wide jobs. To schedule it, add a thin runner that iterates
 * active organisations (mirroring licenceScheduled.service.js / complianceAlerts)
 * and calls this function once per tenant DB, then register that runner in the JOBS
 * array. Sketch:
 *
 *   // in a new runner, e.g. runAuditRetention()
 *   import platformDb from "../models/index.js";
 *   import { getTenantDb } from "./tenantDb.service.js";
 *   import { purgeOldAuditRecords } from "./auditRetention.service.js";
 *
 *   const orgs = await platformDb.Organisation.findAll({
 *     where: { status: { [Op.in]: ["active", "trial"] }, database_name: { [Op.not]: null } },
 *     attributes: ["id", "database_name"],
 *   });
 *   for (const org of orgs) {
 *     const tenantDb = getTenantDb(org.database_name);
 *     await purgeOldAuditRecords(tenantDb, { olderThanDays: 730 });
 *   }
 *
 *   // then in src/jobs/index.js JOBS array:
 *   { name: "audit-retention", schedule: "0 3 * * 0", description: "Purge audit rows > 2y old", fn: runAuditRetention }
 *
 * Default retention is 730 days (2 years), which comfortably exceeds the UKVI
 * sponsor-record retention period; raise `olderThanDays` if a longer legal hold
 * is required.
 */

import { Op } from "sequelize";
import logger from "../utils/logger.js";

/**
 * Delete audit/history rows older than the retention cutoff for a single tenant.
 *
 * @param {object} tenantDb - Resolved tenant Sequelize model registry (from getTenantDb()).
 * @param {object} [options]
 * @param {number} [options.olderThanDays=730] - Rows with created_at strictly before
 *   (now - olderThanDays) are deleted.
 * @returns {Promise<{ cutoff: string, licenceApplicationAudits: number, complianceReviewHistory: number, deleted: number }>}
 */
export async function purgeOldAuditRecords(tenantDb, { olderThanDays = 730 } = {}) {
  const label = "purgeOldAuditRecords";

  if (!tenantDb) {
    logger.warn(`${label}: no tenantDb provided — skipping`);
    return { cutoff: null, licenceApplicationAudits: 0, complianceReviewHistory: 0, deleted: 0 };
  }

  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoff.toISOString();

  let licenceApplicationAudits = 0;
  let complianceReviewHistory = 0;

  // ── licence_application_audits ──────────────────────────────────────────────
  if (tenantDb.LicenceApplicationAudit) {
    try {
      licenceApplicationAudits = await tenantDb.LicenceApplicationAudit.destroy({
        where: { created_at: { [Op.lt]: cutoff } },
      });
    } catch (err) {
      logger.error({ err, cutoff: cutoffStr }, `${label}: licence_application_audits purge failed`);
    }
  } else {
    logger.warn(`${label}: LicenceApplicationAudit model missing on tenantDb — skipping table`);
  }

  // ── compliance_review_history ───────────────────────────────────────────────
  if (tenantDb.ComplianceReviewHistory) {
    try {
      complianceReviewHistory = await tenantDb.ComplianceReviewHistory.destroy({
        where: { created_at: { [Op.lt]: cutoff } },
      });
    } catch (err) {
      logger.error({ err, cutoff: cutoffStr }, `${label}: compliance_review_history purge failed`);
    }
  } else {
    logger.warn(`${label}: ComplianceReviewHistory model missing on tenantDb — skipping table`);
  }

  const deleted = licenceApplicationAudits + complianceReviewHistory;
  logger.info(
    { cutoff: cutoffStr, olderThanDays, licenceApplicationAudits, complianceReviewHistory, deleted },
    `${label}: completed`,
  );

  return {
    cutoff: cutoffStr,
    licenceApplicationAudits,
    complianceReviewHistory,
    deleted,
  };
}

export default purgeOldAuditRecords;
