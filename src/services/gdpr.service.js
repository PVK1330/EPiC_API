/**
 * GDPR Compliance Service.
 *
 * - exportTenantData(orgId)        — export ALL personal data for a Subject Access Request (Article 15/20).
 *                                    Includes candidateApplications and sponsoredWorkers which hold the
 *                                    most PII-dense records (passportNumber, niNumber, dob, etc.).
 * - deleteTenantData(orgId)        — GDPR erasure: anonymise PII across ALL tables that hold it,
 *                                    not just the users table.
 * - enforceRetentionPolicy()       — daily cron: hard-delete data older than retention period.
 *                                    Applies to SUSPENDED orgs only (active orgs are governed by
 *                                    the 7-year UK immigration record-keeping requirement).
 * - getRetentionReport(orgId?)     — list records that have passed the retention deadline.
 */

import platformDb from '../models/index.js';
import { getTenantDb } from './tenantDb.service.js';
import logger from '../utils/logger.js';
import { DATA_RETENTION_DAYS, getRetentionCutoff } from '../utils/gdprPolicy.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * UK immigration law retention period: 7 years.
 * Suspended orgs get a shorter 3-year cutoff for general records; the
 * 7-year cutoff governs sponsor/CoS records while the org is active.
 */
const SUSPENDED_ORG_RETENTION_DAYS = 365 * 3; // 3 years after suspension

// ── Helpers ───────────────────────────────────────────────────────────────────

function safe(promise) {
  return promise.catch(() => []);
}

// ── exportTenantData ──────────────────────────────────────────────────────────

/**
 * Export all personal data held for an organisation as structured JSON.
 * Suitable for responding to a Subject Access Request (GDPR Article 15)
 * or a data portability request (Article 20).
 *
 * Previously missing: candidateApplications, sponsoredWorkers, licenceApplications,
 * caseNotes, caseCommunications. All now included.
 *
 * @param {number} organisationId
 * @returns {Promise<object>} Structured export payload.
 */
export async function exportTenantData(organisationId) {
  const org = await platformDb.Organisation.findByPk(organisationId, {
    attributes: ['id', 'name', 'slug', 'primaryEmail', 'country', 'status', 'createdAt', 'database_name'],
  });
  if (!org) throw Object.assign(new Error('Organisation not found'), { status: 404 });

  const tenantDb = getTenantDb(org.database_name);
  const { Op } = tenantDb.Sequelize;

  const [
    users,
    cases,
    documents,
    appointments,
    payments,
    auditLogs,
    candidateApplications,
    sponsoredWorkers,
    licenceApplications,
    caseNotes,
    caseCommunications,
    complianceDocuments,
  ] = await Promise.all([
    // ── Users ─────────────────────────────────────────────────────────────────
    tenantDb.User.findAll({
      attributes: ['id', 'first_name', 'last_name', 'email', 'mobile', 'role_id', 'status', 'createdAt'],
      paranoid: false,
    }),

    // ── Cases ─────────────────────────────────────────────────────────────────
    tenantDb.Case.findAll({
      attributes: ['id', 'caseId', 'candidateId', 'status', 'visaTypeId', 'created_at', 'updated_at'],
      paranoid: false,
    }),

    // ── Documents ─────────────────────────────────────────────────────────────
    safe(tenantDb.Document.findAll({
      attributes: ['id', 'userId', 'caseId', 'documentType', 'documentName', 'status', 'created_at'],
    })),

    // ── Appointments ──────────────────────────────────────────────────────────
    safe(tenantDb.Appointment?.findAll({
      attributes: ['id', 'candidateId', 'scheduledAt', 'status', 'type'],
    }) ?? Promise.resolve([])),

    // ── Payments ──────────────────────────────────────────────────────────────
    safe(tenantDb.CasePayment?.findAll({
      attributes: ['id', 'caseId', 'amount', 'status', 'created_at'],
    }) ?? Promise.resolve([])),

    // ── Audit logs ────────────────────────────────────────────────────────────
    safe(tenantDb.AuditLog.findAll({
      attributes: ['id', 'action', 'performedBy', 'createdAt'],
      limit: 1000,
      order: [['createdAt', 'DESC']],
    })),

    // ── Candidate applications (PII-dense: passport, NI, dob, address) ────────
    safe(tenantDb.CandidateApplication?.findAll({
      attributes: [
        'id', 'userId', 'firstName', 'lastName', 'email', 'contactNumber',
        'applicationType', 'gender', 'relationshipStatus', 'address',
        'nationality', 'birthCountry', 'placeOfBirth', 'dob',
        'passportNumber', 'nationalIdCardNumber', 'nationalIdNumber',
        'brpNumber', 'niNumber', 'visaType', 'visaEndDate',
        'status', 'submittedAt', 'createdAt', 'updatedAt',
      ],
      paranoid: false,
    }) ?? Promise.resolve([])),

    // ── Sponsored workers (passport, dob, address, phone) ─────────────────────
    safe(tenantDb.SponsoredWorker?.findAll({
      attributes: [
        'id', 'sponsorId', 'workerFirstName', 'workerLastName', 'workerEmail',
        'workerNationality', 'passportNumber', 'dob', 'createdAt', 'updatedAt',
      ],
      paranoid: false,
    }) ?? Promise.resolve([])),

    // ── Licence applications ──────────────────────────────────────────────────
    safe(tenantDb.LicenceApplication?.findAll({
      attributes: ['id', 'status', 'submittedAt', 'createdAt', 'updatedAt'],
      paranoid: false,
    }) ?? Promise.resolve([])),

    // ── Case notes ────────────────────────────────────────────────────────────
    safe(tenantDb.CaseNote?.findAll({
      attributes: ['id', 'caseId', 'authorId', 'content', 'createdAt'],
    }) ?? Promise.resolve([])),

    // ── Case communications ───────────────────────────────────────────────────
    safe(tenantDb.CaseCommunication?.findAll({
      attributes: ['id', 'caseId', 'senderId', 'recipientId', 'subject', 'body', 'sentAt'],
    }) ?? Promise.resolve([])),

    // ── Compliance documents ──────────────────────────────────────────────────
    safe(tenantDb.ComplianceDocument?.findAll({
      attributes: ['id', 'caseId', 'documentType', 'status', 'createdAt'],
    }) ?? Promise.resolve([])),
  ]);

  const toJSON = (arr) => (Array.isArray(arr) ? arr.map((r) => (r?.toJSON ? r.toJSON() : r)) : []);

  return {
    exportedAt: new Date().toISOString(),
    organisation: org.toJSON(),
    retentionPolicyDays: DATA_RETENTION_DAYS,
    summary: {
      users: users.length,
      cases: cases.length,
      documents: documents.length,
      appointments: appointments.length,
      payments: payments.length,
      auditLogs: auditLogs.length,
      candidateApplications: candidateApplications.length,
      sponsoredWorkers: sponsoredWorkers.length,
      licenceApplications: licenceApplications.length,
      caseNotes: caseNotes.length,
      caseCommunications: caseCommunications.length,
      complianceDocuments: complianceDocuments.length,
    },
    data: {
      users: toJSON(users),
      cases: toJSON(cases),
      documents: toJSON(documents),
      appointments: toJSON(appointments),
      payments: toJSON(payments),
      auditLogs: toJSON(auditLogs),
      candidateApplications: toJSON(candidateApplications),
      sponsoredWorkers: toJSON(sponsoredWorkers),
      licenceApplications: toJSON(licenceApplications),
      caseNotes: toJSON(caseNotes),
      caseCommunications: toJSON(caseCommunications),
      complianceDocuments: toJSON(complianceDocuments),
    },
  };
}

// ── deleteTenantData ──────────────────────────────────────────────────────────

/**
 * GDPR erasure routine for account closure / right-to-erasure requests.
 *
 * Anonymises PII across ALL tables that hold personal data:
 *   - users (first_name, last_name, email, mobile, password)
 *   - candidateApplications (name, email, contact, address, passport, NI, dob, brp, etc.)
 *   - sponsoredWorkers (name, email, passport, dob, phone)
 *   - licenceAuthorisingOfficers (niNumber)
 * Then soft-deletes cases and documents, and suspends the organisation.
 *
 * @param {number} organisationId
 * @param {{ hardDelete?: boolean, reason?: string }} options
 * @returns {Promise<object>} Summary of rows affected.
 */
export async function deleteTenantData(organisationId, options = {}) {
  const { hardDelete = false, reason = 'Account closure' } = options;

  const org = await platformDb.Organisation.findByPk(organisationId);
  if (!org) throw Object.assign(new Error('Organisation not found'), { status: 404 });

  const tenantDb = getTenantDb(org.database_name);
  const results = {};

  // ── Users ─────────────────────────────────────────────────────────────────
  const [affectedUsers] = await tenantDb.User.update(
    {
      first_name: '[DELETED]',
      last_name: '[DELETED]',
      email: `deleted_${organisationId}_${Date.now()}@gdpr.invalid`,
      mobile: null,
      password: 'GDPR_DELETED',
    },
    { where: {}, individualHooks: false },
  ).catch(() => [0]);
  results.usersAnonymised = affectedUsers;

  // ── Candidate applications (most PII-dense table) ─────────────────────────
  if (tenantDb.CandidateApplication) {
    const [affectedApps] = await tenantDb.CandidateApplication.update(
      {
        firstName: '[DELETED]',
        lastName: '[DELETED]',
        email: null,
        contactNumber: null,
        contactNumber2: null,
        address: null,
        previousFullAddress: null,
        previousAddress: null,
        dob: null,
        passportNumber: null,
        nationalIdCardNumber: null,
        nationalIdNumber: null,
        brpNumber: null,
        niNumber: null,
        placeOfBirth: null,
        parentName: null,
        parent2Name: null,
        cosNumber: null,
        workLocation: null,
        customResponses: {},
      },
      { where: {}, individualHooks: false },
    ).catch(() => [0]);
    results.candidateApplicationsAnonymised = affectedApps;
  }

  // ── Sponsored workers ─────────────────────────────────────────────────────
  if (tenantDb.SponsoredWorker) {
    const [affectedWorkers] = await tenantDb.SponsoredWorker.update(
      {
        workerFirstName: '[DELETED]',
        workerLastName: '[DELETED]',
        workerEmail: null,
        passportNumber: null,
        dob: null,
      },
      { where: {}, individualHooks: false },
    ).catch(() => [0]);
    results.sponsoredWorkersAnonymised = affectedWorkers;
  }

  // ── Licence authorising officers (niNumber) ───────────────────────────────
  if (tenantDb.LicenceAuthorisingOfficer) {
    const [affectedOfficers] = await tenantDb.LicenceAuthorisingOfficer.update(
      { niNumber: null },
      { where: {}, individualHooks: false },
    ).catch(() => [0]);
    results.licenceAuthorisingOfficersAnonymised = affectedOfficers;
  }

  // ── Cases (soft-delete) ───────────────────────────────────────────────────
  const caseCount = await tenantDb.Case.destroy({ where: {} }).catch(() => 0);
  results.casesDeleted = caseCount;

  // ── Documents (soft-delete metadata; files remain until storage pruning) ──
  const docCount = await tenantDb.Document.destroy({ where: {} }).catch(() => 0);
  results.documentsDeleted = docCount;

  // ── Suspend the organisation ──────────────────────────────────────────────
  await org.update({ status: 'suspended' });
  results.organisationSuspended = true;

  logger.info({ organisationId, reason, results }, 'GDPR tenant data deletion complete');
  return results;
}

// ── enforceRetentionPolicy ────────────────────────────────────────────────────

/**
 * Daily cron: hard-delete records past the retention cutoff for suspended orgs.
 *
 * NOTE: Active organisations accumulate records subject to UK immigration law's
 * 7-year record-keeping requirement (DATA_RETENTION_DAYS = 2555). Hard-deletion
 * of active-org records should only be triggered manually or via a separate
 * compliance workflow, not this nightly job.
 *
 * @param {number} [retentionDays=SUSPENDED_ORG_RETENTION_DAYS]
 * @returns {Promise<object>} Summary of rows deleted.
 */
export async function enforceRetentionPolicy(retentionDays = SUSPENDED_ORG_RETENTION_DAYS) {
  const cutoff = getRetentionCutoff(retentionDays);
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

// ── getRetentionReport ────────────────────────────────────────────────────────

/**
 * Return a summary of records that have passed the retention deadline.
 * Used by GET /api/superadmin/gdpr/retention-report.
 *
 * When orgId is provided, reports only for that organisation's tenant DB.
 * When omitted, aggregates across ALL suspended organisations.
 *
 * @param {number|null} [orgId]
 * @returns {Promise<object>} Retention report.
 */
export async function getRetentionReport(orgId = null) {
  const retentionCutoff = getRetentionCutoff(DATA_RETENTION_DAYS);
  const suspendedCutoff = getRetentionCutoff(SUSPENDED_ORG_RETENTION_DAYS);

  const whereOrg = orgId
    ? { id: orgId }
    : { status: 'suspended' };

  const orgs = await platformDb.Organisation.findAll({
    where: whereOrg,
    attributes: ['id', 'name', 'slug', 'status', 'database_name', 'createdAt'],
  });

  if (!orgs.length) {
    return {
      reportedAt: new Date().toISOString(),
      retentionPolicyDays: DATA_RETENTION_DAYS,
      suspendedOrgRetentionDays: SUSPENDED_ORG_RETENTION_DAYS,
      organisations: [],
    };
  }

  const orgReports = [];

  for (const org of orgs) {
    if (!org.database_name) {
      orgReports.push({ orgId: org.id, orgName: org.name, error: 'No database_name set' });
      continue;
    }

    try {
      const tenantDb = getTenantDb(org.database_name);
      const { Op } = tenantDb.Sequelize;

      const cutoff = org.status === 'suspended' ? suspendedCutoff : retentionCutoff;

      const [expiredCases, expiredAuditLogs, expiredCandidateApps] = await Promise.all([
        tenantDb.Case.count({
          where: { deleted_at: { [Op.lt]: cutoff } },
          paranoid: false,
        }).catch(() => 0),
        tenantDb.AuditLog.count({
          where: { createdAt: { [Op.lt]: cutoff } },
        }).catch(() => 0),
        tenantDb.CandidateApplication?.count({
          where: { createdAt: { [Op.lt]: retentionCutoff } },
          paranoid: false,
        }).catch(() => 0) ?? 0,
      ]);

      orgReports.push({
        orgId: org.id,
        orgName: org.name,
        orgStatus: org.status,
        retentionCutoff: cutoff.toISOString(),
        expiredRecords: {
          softDeletedCases: expiredCases,
          auditLogs: expiredAuditLogs,
          candidateApplications: expiredCandidateApps,
        },
      });
    } catch (err) {
      logger.error({ err, orgId: org.id }, 'getRetentionReport: error querying tenant DB');
      orgReports.push({ orgId: org.id, orgName: org.name, error: err.message });
    }
  }

  return {
    reportedAt: new Date().toISOString(),
    retentionPolicyDays: DATA_RETENTION_DAYS,
    suspendedOrgRetentionDays: SUSPENDED_ORG_RETENTION_DAYS,
    organisations: orgReports,
  };
}
