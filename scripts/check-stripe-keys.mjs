// Throwaway diagnostic: validates every Stripe secret key the app actually uses
// (env, each tenant payment_settings, platform PlatformSetting) by making a real
// lightweight Stripe API call through the app's own key loaders.
import dotenv from 'dotenv';
dotenv.config({ path: new URL('../.env', import.meta.url) });
import Stripe from 'stripe';
import platformDb from '../src/models/index.js';
import { getTenantDb } from '../src/services/tenantDb.service.js';
import {
  getTenantPaymentSettings,
  getPlatformPaymentSettings,
} from '../src/services/stripeTenant.service.js';

const mask = (k) => (k ? `${k.slice(0, 12)}…${k.slice(-4)} (len ${k.length})` : '(none)');

async function validateKey(label, secretKey, webhookSecret) {
  const line = { label, secret: mask(secretKey), webhook: webhookSecret ? 'set' : 'EMPTY' };
  if (!secretKey) {
    line.result = 'NO KEY CONFIGURED';
    return line;
  }
  try {
    const stripe = new Stripe(secretKey);
    // balance.retrieve authenticates the key against the Stripe account.
    const balance = await stripe.balance.retrieve();
    const acct = await stripe.accounts.retrieve().catch(() => null);
    line.result = 'VALID ✓';
    line.livemode = balance.livemode ? 'LIVE' : 'TEST';
    line.account = acct?.id || '(restricted key — account hidden)';
    line.country = acct?.country || '';
  } catch (e) {
    line.result = `INVALID ✗ — ${e.type || ''} ${e.message}`;
  }
  return line;
}

const results = [];

// 1) .env key (note: candidate/tenant flow does NOT use this; included for completeness)
results.push(
  await validateKey('ENV STRIPE_SECRET_KEY', process.env.STRIPE_SECRET_KEY, process.env.STRIPE_WEBHOOK_SECRET)
);

// 2) Platform (superadmin) key — used by org-subscription billing
try {
  const p = await getPlatformPaymentSettings();
  results.push(await validateKey('PLATFORM (PlatformSetting)', p.stripe_secret_key, p.stripe_webhook_secret));
} catch (e) {
  results.push({ label: 'PLATFORM (PlatformSetting)', result: `lookup failed: ${e.message}` });
}

// 3) Every tenant's key — used by the candidate/sponsor case-fee flow
try {
  const orgs = await platformDb.Organisation.findAll({
    attributes: ['id', 'name', 'slug', 'database_name'],
  });
  for (const org of orgs) {
    if (!org.database_name) {
      results.push({ label: `TENANT ${org.name} (${org.slug})`, result: 'no tenant DB (shared)' });
      continue;
    }
    try {
      const tenantDb = getTenantDb(org.database_name);
      const s = await getTenantPaymentSettings(tenantDb);
      results.push(
        await validateKey(`TENANT ${org.name} [${org.database_name}]`, s.stripe_secret_key, s.stripe_webhook_secret)
      );
    } catch (e) {
      results.push({ label: `TENANT ${org.name} [${org.database_name}]`, result: `db error: ${e.message}` });
    }
  }
} catch (e) {
  results.push({ label: 'TENANTS', result: `org list failed: ${e.message}` });
}

console.log('\n================ STRIPE KEY VALIDATION ================\n');
for (const r of results) {
  console.log(`• ${r.label}`);
  console.log(`    secret : ${r.secret ?? '-'}`);
  console.log(`    webhook: ${r.webhook ?? '-'}`);
  console.log(`    result : ${r.result}${r.livemode ? `  [${r.livemode}]` : ''}`);
  if (r.account) console.log(`    account: ${r.account} ${r.country}`);
  console.log('');
}
console.log('======================================================\n');

process.exit(0);
