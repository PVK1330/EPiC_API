import 'dotenv/config';
import bcrypt from 'bcryptjs';
import db from './src/models/index.js';
import { getTenantDb } from './src/services/tenantDb.service.js';
import { createUserOnPlatformAndTenant } from './src/services/userSync.service.js';
import { seedTenantOrganisation } from './src/services/tenantSeed.service.js';
import {
  provisionOrganisationTenantDatabase,
  isPhysicalTenantDatabaseEnabled,
} from './src/services/tenantDatabaseProvision.service.js';

// A genuinely fresh org for this QA audit pass.
const SLUG = 'qa-audit-2026';
const NAME = 'QA Audit Org 2026';
const PASSWORD = 'QaAudit@2026!'; // 12+ chars, upper/lower/digit/special
const ROLES = [
  { key: 'admin',      role_id: 3, first: 'Ava',   last: 'Admin',      email: 'admin@qaaudit.test',      mobile: '7900000041' },
  { key: 'caseworker', role_id: 2, first: 'Carl',  last: 'Caseworker', email: 'caseworker@qaaudit.test', mobile: '7900000042' },
  { key: 'candidate',  role_id: 1, first: 'Cara',  last: 'Candidate',  email: 'candidate@qaaudit.test',  mobile: '7900000043' },
  { key: 'sponsor',    role_id: 4, first: 'Sam',   last: 'Sponsor',    email: 'sponsor@qaaudit.test',    mobile: '7900000044' },
];

async function run() {
  const hashed = await bcrypt.hash(PASSWORD, 12);
  const now = new Date();
  const trialEndsAt = new Date(now); trialEndsAt.setDate(trialEndsAt.getDate() + 30);

  const plan = await db.Plan.findOne({ order: [['id', 'ASC']] });
  if (!plan) { console.error('No plans found; aborting.'); process.exit(1); }

  let org = await db.Organisation.findOne({ where: { slug: SLUG } });
  let databaseName = org?.database_name || null;

  if (!org) {
    let databaseNameLocal = null;
    if (isPhysicalTenantDatabaseEnabled()) {
      const meta = await provisionOrganisationTenantDatabase(SLUG);
      databaseNameLocal = meta.databaseName;
    }
    databaseName = databaseNameLocal;
    org = await db.Organisation.create({
      name: NAME, slug: SLUG, plan: 'starter', plan_id: plan.id,
      status: 'trial', primaryEmail: 'admin@qaaudit.test', country: 'GB',
      database_name: databaseName,
    });
    console.log('Created org', org.id, 'db:', databaseName);
  } else {
    if (!org.plan_id) { await org.update({ plan_id: plan.id }); }
    console.log('Reusing org', org.id, 'db:', databaseName);
  }

  const existingSub = await db.Subscription.findOne({ where: { organisation_id: org.id } });
  if (!existingSub) {
    await db.Subscription.create({
      organisation_id: org.id, plan_id: plan.id, status: 'trial',
      current_period_start: now, current_period_end: trialEndsAt, trial_ends_at: trialEndsAt,
    });
    console.log('Created trial subscription on plan', plan.id);
  } else {
    console.log('Subscription already exists');
  }

  if (!databaseName) { console.error('No tenant DB; aborting.'); process.exit(1); }
  const tenantDb = getTenantDb(databaseName);
  try { await seedTenantOrganisation(tenantDb, org); } catch (e) { console.log('seedTenantOrganisation:', e.message); }

  const out = [];
  for (const r of ROLES) {
    const existing = await db.User.findOne({ where: { email: r.email } });
    if (existing) {
      await existing.update({ password: hashed, status: 'active', is_otp_verified: true, is_email_verified: true });
      try { const { mirrorUserToTenant } = await import('./src/services/userSync.service.js'); await mirrorUserToTenant(tenantDb, existing); } catch {}
      out.push({ ...r, id: existing.id, note: 'updated' });
      continue;
    }
    const user = await createUserOnPlatformAndTenant(tenantDb, {
      email: r.email, first_name: r.first, last_name: r.last,
      country_code: '+44', mobile: r.mobile, password: hashed,
      role_id: r.role_id, organisation_id: org.id,
      temp_password: null, is_otp_verified: true, is_email_verified: true, status: 'active',
    });
    out.push({ ...r, id: user.id, note: 'created' });
  }

  console.log('___CREDS_START___');
  console.log(JSON.stringify({
    org: { id: org.id, name: NAME, slug: SLUG, database_name: databaseName, status: org.status },
    loginUrl: 'http://' + SLUG + '.localhost:5173',
    password: PASSWORD,
    users: out,
  }, null, 2));
  console.log('___CREDS_END___');
  process.exit(0);
}

run().catch(e => { console.error('SEED_ERROR', e); process.exit(1); });
