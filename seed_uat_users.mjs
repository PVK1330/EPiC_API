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

const SLUG = 'uat-qa-org';
const NAME = 'UAT QA Organisation';
const PASSWORD = 'UatTest@2026!'; // meets strong policy: 12+ upper/lower/digit/special
const ROLES = [
  { key: 'admin',      role_id: 3, first: 'Uat', last: 'Admin',      email: 'admin@uatqa.test',      mobile: '7900000031' },
  { key: 'caseworker', role_id: 2, first: 'Uat', last: 'Caseworker', email: 'caseworker@uatqa.test', mobile: '7900000032' },
  { key: 'candidate',  role_id: 1, first: 'Uat', last: 'Candidate',  email: 'candidate@uatqa.test',  mobile: '7900000033' },
  { key: 'sponsor',    role_id: 4, first: 'Uat', last: 'Sponsor',    email: 'sponsor@uatqa.test',    mobile: '7900000034' },
];

async function run() {
  const hashed = await bcrypt.hash(PASSWORD, 12);
  const now = new Date();
  const trialEndsAt = new Date(now); trialEndsAt.setDate(trialEndsAt.getDate() + 30);

  // A valid plan_id is required (Subscription.plan_id is NOT NULL).
  const plan = await db.Plan.findOne({ order: [['id', 'ASC']] });
  if (!plan) { console.error('No plans found; aborting.'); process.exit(1); }

  // 1. Org (idempotent)
  let org = await db.Organisation.findOne({ where: { slug: SLUG } });
  let databaseName = org?.database_name || null;

  if (!org) {
    let provisionMeta = null;
    if (isPhysicalTenantDatabaseEnabled()) {
      provisionMeta = await provisionOrganisationTenantDatabase(SLUG);
      databaseName = provisionMeta.databaseName;
    }
    org = await db.Organisation.create({
      name: NAME, slug: SLUG, plan: 'starter', plan_id: plan.id,
      status: 'trial', primaryEmail: 'admin@uatqa.test', country: 'GB',
      database_name: databaseName,
    });
    console.log('Created org', org.id, 'db:', databaseName);
  } else {
    if (!org.plan_id) { await org.update({ plan_id: plan.id }); }
    console.log('Reusing org', org.id, 'db:', databaseName);
  }

  // Subscription (idempotent)
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

  // 2. Users (idempotent per email)
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
    loginUrl: 'http://localhost:5173  (tenant: ' + SLUG + ')',
    password: PASSWORD,
    users: out,
  }, null, 2));
  console.log('___CREDS_END___');
  process.exit(0);
}

run().catch(e => { console.error('SEED_ERROR', e); process.exit(1); });
