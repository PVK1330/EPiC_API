/**
 * auditRetentionRunner.service.js
 *
 * Platform-wide runner for audit record retention.
 * Iterates every active/trial organisation and calls purgeOldAuditRecords()
 * on each tenant DB, then returns a consolidated summary.
 *
 * This is the zero-argument function registered in src/jobs/index.js.
 * The per-tenant logic lives in auditRetention.service.js.
 *
 * Default retention: 730 days (2 years), matching UKVI sponsor record guidance.
 * Override via AUDIT_RETENTION_DAYS environment variable.
 */

import { Op } from 'sequelize';
import platformDb from '../models/index.js';
import { getTenantDb } from './tenantDb.service.js';
import { purgeOldAuditRecords } from './auditRetention.service.js';
import logger from '../utils/logger.js';

const AUDIT_RETENTION_DAYS = (() => {
  const override = parseInt(process.env.AUDIT_RETENTION_DAYS, 10);
  return Number.isFinite(override) && override > 0 ? override : 730;
})();

/**
 * Run audit retention across all active/trial organisations.
 * Called by the node-cron scheduler; must be a zero-argument async function.
 *
 * @returns {Promise<{ orgsProcessed: number, orgsErrored: number, totalDeleted: number }>}
 */
export async function runAuditRetention() {
  const label = 'runAuditRetention';
  logger.info({ olderThanDays: AUDIT_RETENTION_DAYS }, `${label}: starting`);

  const orgs = await platformDb.Organisation.findAll({
    where: {
      status: { [Op.in]: ['active', 'trial'] },
      database_name: { [Op.not]: null },
    },
    attributes: ['id', 'database_name'],
  });

  let orgsProcessed = 0;
  let orgsErrored = 0;
  let totalDeleted = 0;

  for (const org of orgs) {
    try {
      const tenantDb = getTenantDb(org.database_name);
      const result = await purgeOldAuditRecords(tenantDb, { olderThanDays: AUDIT_RETENTION_DAYS });
      totalDeleted += result.deleted ?? 0;
      orgsProcessed++;
    } catch (err) {
      logger.error({ err, orgId: org.id }, `${label}: error processing org`);
      orgsErrored++;
    }
  }

  logger.info({ orgsProcessed, orgsErrored, totalDeleted }, `${label}: completed`);
  return { orgsProcessed, orgsErrored, totalDeleted };
}

export default runAuditRetention;
