/**
 * Week 8: Demo/sandbox environment per tenant.
 *
 * - createSandboxOrganisation(name)  — provision a sandbox org with seed data
 * - resetSandboxEnvironments()       — daily cron: truncate + re-seed all sandbox orgs
 * - seedSandboxData(tenantDb)        — populate sandbox with sample cases/candidates/workers
 */
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import platformDb from '../models/index.js';
import { getTenantDb } from './tenantDb.service.js';
import {
  provisionOrganisationTenantDatabase,
  isPhysicalTenantDatabaseEnabled,
} from './tenantDatabaseProvision.service.js';
import logger from '../utils/logger.js';

const SANDBOX_PREFIX = 'demo_';

async function seedSandboxData(tenantDb, orgId) {
  const now = new Date();

  const ROLES = { ADMIN: 3, CASEWORKER: 2, CANDIDATE: 1 };
  const pwHash = await bcrypt.hash('Demo@1234', 10);

  // Seed demo users
  const [admin] = await tenantDb.User.findOrCreate({
    where: { email: 'demo.admin@sandbox.epic' },
    defaults: {
      first_name: 'Demo', last_name: 'Admin', email: 'demo.admin@sandbox.epic',
      password: pwHash, role_id: ROLES.ADMIN, status: 'active', organisation_id: orgId,
    },
  });

  const [caseworker] = await tenantDb.User.findOrCreate({
    where: { email: 'demo.caseworker@sandbox.epic' },
    defaults: {
      first_name: 'Alex', last_name: 'Caseworker', email: 'demo.caseworker@sandbox.epic',
      password: pwHash, role_id: ROLES.CASEWORKER, status: 'active', organisation_id: orgId,
    },
  });

  const [candidate] = await tenantDb.User.findOrCreate({
    where: { email: 'demo.candidate@sandbox.epic' },
    defaults: {
      first_name: 'Jane', last_name: 'Doe', email: 'demo.candidate@sandbox.epic',
      password: pwHash, role_id: ROLES.CANDIDATE, status: 'active', organisation_id: orgId,
    },
  });

  // Seed 5 demo cases
  const statuses = ['Lead', 'Pending', 'In Progress', 'Submitted', 'Approved'];
  const casePromises = statuses.map((status, i) =>
    tenantDb.Case.findOrCreate({
      where: { caseId: `DEMO-00${i + 1}` },
      defaults: {
        caseId: `DEMO-00${i + 1}`,
        candidateId: candidate.id,
        assignedcaseworkerId: [caseworker.id],
        status,
        priority: ['low', 'medium', 'high', 'urgent', 'medium'][i],
        targetSubmissionDate: new Date(now.getTime() + (i + 1) * 30 * 24 * 60 * 60 * 1000),
        notes: `Demo case ${i + 1} — pre-populated for evaluation`,
        organisation_id: orgId,
        totalAmount: (i + 1) * 500,
        paidAmount: i * 250,
      },
    }).then(([c]) => c)
  );
  await Promise.all(casePromises);

  logger.info({ orgId }, 'Sandbox seed data populated');
}

async function truncateSandboxData(tenantDb) {
  const models = ['Case', 'Document', 'Appointment', 'Notification', 'AuditLog'];
  for (const model of models) {
    if (tenantDb[model]) {
      await tenantDb[model].destroy({ where: {}, force: true, truncate: false }).catch(() => {});
    }
  }
  // Also remove demo users (except keep schema)
  await tenantDb.User.destroy({
    where: { email: { [tenantDb.Sequelize.Op.like]: '%@sandbox.epic' } },
    force: true,
  }).catch(() => {});
}

export async function resetSandboxEnvironments() {
  const results = { orgsFound: 0, reset: 0, errors: 0 };

  const sandboxOrgs = await platformDb.Organisation.findAll({
    where: { is_sandbox: true },
    attributes: ['id', 'name', 'database_name'],
  });

  results.orgsFound = sandboxOrgs.length;

  for (const org of sandboxOrgs) {
    if (!org.database_name) continue;
    try {
      const tenantDb = getTenantDb(org.database_name);
      await truncateSandboxData(tenantDb);
      await seedSandboxData(tenantDb, org.id);
      results.reset++;
      logger.info({ orgId: org.id, name: org.name }, 'Sandbox org reset complete');
    } catch (err) {
      results.errors++;
      logger.error({ err, orgId: org.id }, 'Sandbox reset failed');
    }
  }

  return results;
}

export async function createSandboxOrganisation({ name = 'EPiC Demo', adminEmail } = {}) {
  const slug = `${SANDBOX_PREFIX}${randomBytes(4).toString('hex')}`;
  const email = adminEmail || `sandbox-${slug}@epic.demo`;

  const org = await platformDb.Organisation.create({
    name,
    slug,
    primaryEmail: email,
    status: 'active',
    is_sandbox: true,
    timezone: 'Europe/London',
  });

  if (isPhysicalTenantDatabaseEnabled()) {
    await provisionOrganisationTenantDatabase(org);
  }

  if (org.database_name) {
    const tenantDb = getTenantDb(org.database_name);
    await seedSandboxData(tenantDb, org.id);
  }

  logger.info({ orgId: org.id, slug }, 'Sandbox organisation created');
  return { id: org.id, slug, name, is_sandbox: true };
}
