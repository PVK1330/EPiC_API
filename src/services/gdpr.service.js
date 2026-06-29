/**
 * Week 8: GDPR Compliance Service.
 *
 * - exportTenantData(orgId)     — export all tenant data as structured JSON
 * - deleteTenantData(orgId)     — GDPR erasure: soft-delete users + cases, wipe PII
 * - enforceRetentionPolicy()    — daily cron: hard-delete data older than retention period
 */
import platformDb from '../models/index.js';
import { getTenantDb } from './tenantDb.service.js';
import logger from '../utils/logger.js';

const DEFAULT_RETENTION_DAYS = 365 * 3; // 3 years

export async function exportTenantData(organisationId) {
  const org = await platformDb.Organisation.findByPk(organisationId, {
    attributes: ['id', 'name', 'slug', 'primaryEmail', 'country', 'status', 'createdAt'],
  });
  if (!org) throw Object.assign(new Error('Organisation not found'), { status: 404 });

  const tenantDb = getTenantDb(org.database_name);

  const [users, cases, documents, appointments, payments, auditLogs] = await Promise.all([
    tenantDb.User.findAll({
      attributes: ['id', 'first_name', 'last_name', 'email', 'mobile', 'role_id', 'status', 'createdAt'],
      paranoid: false,
    }),
    tenantDb.Case.findAll({
      attributes: ['id', 'caseId', 'candidateId', 'status', 'visaTypeId', 'created_at', 'updated_at'],
      paranoid: false,
    }),
    tenantDb.Document.findAll({
      attributes: ['id', 'userId', 'caseId', 'documentType', 'documentName', 'status', 'created_at'],
    }).catch(() => []),
    tenantDb.Appointment?.findAll({
      attributes: ['id', 'candidateId', 'scheduledAt', 'status', 'type'],
    }).catch(() => []) ?? [],
    tenantDb.CasePayment?.findAll({
      attributes: ['id', 'caseId', 'amount', 'status', 'created_at'],
    }).catch(() => []) ?? [],
    tenantDb.AuditLog.findAll({
      attributes: ['id', 'action', 'performedBy', 'createdAt'],
      limit: 1000,
      order: [['createdAt', 'DESC']],
    }).catch(() => []),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    organisation: org.toJSON(),
    summary: {
      users: users.length,
      cases: cases.length,
      documents: documents.length,
      appointments: appointments.length,
      payments: payments.length,
      auditLogs: auditLogs.length,
    },
    data: {
      users: users.map((u) => u.toJSON()),
      cases: cases.map((c) => c.toJSON()),
      documents: documents.map((d) => d.toJSON()),
      appointments: appointments.map((a) => a.toJSON()),
      payments: payments.map((p) => p.toJSON()),
      auditLogs: auditLogs.map((l) => l.toJSON()),
    },
  };
}

export async function deleteTenantData(organisationId, options = {}) {
  const { hardDelete = false, reason = 'Account closure' } = options;

  const org = await platformDb.Organisation.findByPk(organisationId);
  if (!org) throw Object.assign(new Error('Organisation not found'), { status: 404 });

  const tenantDb = getTenantDb(org.database_name);
  const results = {};

  // Wipe PII from users
  const [affectedUsers] = await tenantDb.User.update(
    {
      first_name: '[DELETED]',
      last_name: '[DELETED]',
      email: `deleted_${organisationId}_${Date.now()}@gdpr.invalid`,
      mobile: null,
      password: 'GDPR_DELETED',
    },
    { where: {}, individualHooks: false }
  ).catch(() => [0]);
  results.usersAnonymised = affectedUsers;

  // Soft-delete all cases
  const caseCount = await tenantDb.Case.destroy({ where: {} }).catch(() => 0);
  results.casesDeleted = caseCount;

  // Soft-delete documents metadata (files remain until storage pruning)
  const docCount = await tenantDb.Document.destroy({ where: {} }).catch(() => 0);
  results.documentsDeleted = docCount;

  // Suspend the organisation
  await org.update({ status: 'suspended' });

  logger.info({ organisationId, reason, results }, 'GDPR tenant data deletion complete');
  return results;
}

export async function enforceRetentionPolicy(retentionDays = DEFAULT_RETENTION_DAYS) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const results = { orgsProcessed: 0, casesHardDeleted: 0, auditLogsDeleted: 0 };

  const orgs = await platformDb.Organisation.findAll({
    where: { status: 'suspended' },
    attributes: ['id', 'database_name'],
  });

  for (const org of orgs) {
    if (!org.database_name) continue;
    results.orgsProcessed++;
    try {
      const tenantDb = getTenantDb(org.database_name);

      const { Op } = tenantDb.Sequelize;

      const deleted = await tenantDb.Case.destroy({
        where: { deleted_at: { [Op.lt]: cutoff } },
        force: true,
      }).catch(() => 0);
      results.casesHardDeleted += deleted;

      const auditDeleted = await tenantDb.AuditLog.destroy({
        where: { createdAt: { [Op.lt]: cutoff } },
        force: true,
      }).catch(() => 0);
      results.auditLogsDeleted += auditDeleted;
    } catch (err) {
      logger.error({ err, orgId: org.id }, 'GDPR retention policy: error processing org');
    }
  }

  return results;
}
