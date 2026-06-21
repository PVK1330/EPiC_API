import Stripe from "stripe";
import { Op } from "sequelize";
import platformDb from "../models/index.js";
import { getTenantDb } from "./tenantDb.service.js";
import { notifyUser, NotificationTypes, NotificationPriority } from "./notification.service.js";
import { toPublicImagePath } from "../utils/storagePath.util.js";

/**
 * @deprecated Prefer toPublicImagePath() directly. Retained as a thin alias so
 * existing callers keep working. Returns the RELATIVE public image path
 * ("api/public/images/<basename>"); the frontend's resolveAssetUrl() prepends
 * the API origin, so no host is embedded here anymore.
 */
export function toPublicAssetUrl(relativePath) {
  return toPublicImagePath(relativePath);
}

/**
 * Load the tenant's payment row. Stripe keys come ONLY from the tenant DB
 * (payment_settings) — entered by the org admin in Admin → Payment Config.
 * There is deliberately NO process.env fallback: a tenant with no keys must
 * fail loudly (callers surface a "configure in Admin" error) rather than
 * silently transacting on whatever account env keys happen to point at, which
 * would break per-tenant isolation.
 */
export async function getTenantPaymentSettings(tenantDb) {
  if (!tenantDb?.PaymentSetting) {
    return {
      stripe_secret_key: null,
      stripe_public_key: null,
      stripe_webhook_secret: null,
    };
  }
  let row = await tenantDb.PaymentSetting.findOne();
  if (!row) {
    row = await tenantDb.PaymentSetting.create({});
  }
  const plain = row.toJSON ? row.toJSON() : row;
  return {
    ...plain,
    stripe_secret_key: plain.stripe_secret_key || null,
    stripe_public_key: plain.stripe_public_key || null,
    stripe_webhook_secret: plain.stripe_webhook_secret || null,
  };
}

export function createStripeClient(secretKey) {
  if (!secretKey) {
    throw new Error("Stripe secret key is not configured for this organisation");
  }
  return new Stripe(secretKey);
}

export async function getStripeForTenant(tenantDb) {
  const settings = await getTenantPaymentSettings(tenantDb);
  return {
    stripe: createStripeClient(settings.stripe_secret_key),
    settings,
  };
}

/**
 * Load the platform (superadmin) Stripe credentials. These come ONLY from the
 * platform DB (PlatformSetting), entered by the superadmin in Settings →
 * Commerce — never from process.env.
 *
 * Note on the publishable key name: the superadmin form (configureGateway)
 * persists it under `stripe_publishable_key`; older rows may use
 * `stripe_public_key`. We read both so the saved key is always found, and
 * expose it as `stripe_public_key` for a uniform shape with the tenant getter.
 */
export async function getPlatformPaymentSettings() {
  const keys = [
    'stripe_secret_key',
    'stripe_publishable_key',
    'stripe_public_key',
    'stripe_webhook_secret',
  ];
  const settings = await platformDb.PlatformSetting.findAll({
    where: { key: keys }
  });

  const map = {};
  for (const s of settings) map[s.key] = s.value;

  return {
    stripe_secret_key: map.stripe_secret_key || null,
    stripe_public_key: map.stripe_publishable_key || map.stripe_public_key || null,
    stripe_webhook_secret: map.stripe_webhook_secret || null,
  };
}

export async function getStripeForRequest(req) {
  if (!req?.tenantDb) {
    const settings = await getPlatformPaymentSettings();
    if (!settings.stripe_secret_key) throw new Error("Stripe is not configured for platform");
    return {
      stripe: createStripeClient(settings.stripe_secret_key),
      settings,
    };
  }
  return getStripeForTenant(req.tenantDb);
}

export function buildStripeMetadata(req, extra = {}) {
  const organisationId = req?.user?.organisation_id ?? null;
  return {
    organisationId: organisationId != null ? String(organisationId) : "",
    ...extra,
  };
}

export async function resolveTenantDbByOrganisationId(organisationId) {
  if (!organisationId) return null;
  const org = await platformDb.Organisation.findByPk(Number(organisationId), {
    attributes: ["id", "database_name"],
  });
  if (!org?.database_name) return null;
  return getTenantDb(org.database_name);
}

export async function resolveTenantDbFromStripeObject(stripeObject) {
  const meta = stripeObject?.metadata || {};
  if (meta.organisationId) {
    const tenantDb = await resolveTenantDbByOrganisationId(meta.organisationId);
    if (tenantDb) return { tenantDb, organisationId: Number(meta.organisationId) };
  }

  const customerId =
    typeof stripeObject?.customer === "string"
      ? stripeObject.customer
      : stripeObject?.customer?.id || stripeObject?.customer_id;

  if (customerId) {
    const orgs = await platformDb.Organisation.findAll({
      where: { database_name: { [Op.ne]: null } },
      attributes: ["id", "database_name"],
    });
    for (const org of orgs) {
      if (!org.database_name) continue;
      try {
        const tenantDb = getTenantDb(org.database_name);
        await tenantDb.sequelize.authenticate();
        const prefs = await tenantDb.CandidateAccountSettings.findOne({
          where: { stripe_customer_id: customerId },
        });
        if (prefs) {
          return { tenantDb, organisationId: org.id };
        }
      } catch {
        /* skip unreachable tenant DB */
      }
    }
  }

  return { tenantDb: null, organisationId: null };
}

/**
 * Verify an incoming Stripe webhook using the signing secret stored in the DB:
 *   - the tenant webhook secret when the event payload carries
 *     metadata.organisationId (candidate / sponsor / tenant events), else
 *   - the platform webhook secret (PlatformSetting) for org-subscription events.
 *
 * Secrets come ONLY from the DB — never from process.env.
 *
 * Production has no Stripe webhook signing secret configured yet, and the
 * post-redirect verify-session endpoints (candidate verifyCheckoutSession +
 * org-billing verifySession) are the AUTHORITATIVE payment finalisers. So a
 * missing signing secret must NOT crash the endpoint or dead-letter every
 * event: we return `{ verified: false, event }` (the parsed-but-untrusted
 * payload) and let the caller ACK and skip side effects. When a secret IS
 * configured, a bad signature still throws (genuine tampering / misconfig).
 *
 * @returns {Promise<{ verified: boolean, event: object }>}
 */
export async function constructStripeWebhookEvent(rawBody, signature) {
  let payload;
  try {
    payload = JSON.parse(rawBody.toString());
  } catch {
    throw new Error("Invalid webhook payload");
  }

  const metaOrgId = payload?.data?.object?.metadata?.organisationId;

  let webhookSecret = null;
  let apiSecret = null;

  // Tenant-signed events carry organisationId in metadata → verify with that
  // tenant's own webhook secret + API key.
  if (metaOrgId) {
    const tenantDb = await resolveTenantDbByOrganisationId(metaOrgId);
    if (tenantDb) {
      const settings = await getTenantPaymentSettings(tenantDb);
      webhookSecret = settings.stripe_webhook_secret || null;
      apiSecret = settings.stripe_secret_key || null;
    }
  }

  // Platform-signed events (e.g. org subscriptions, which deliberately omit
  // organisationId) — or a tenant whose own secret is unset — fall to the
  // platform credentials.
  if (!webhookSecret || !apiSecret) {
    const pSettings = await getPlatformPaymentSettings();
    webhookSecret = webhookSecret || pSettings.stripe_webhook_secret || null;
    apiSecret = apiSecret || pSettings.stripe_secret_key || null;
  }

  // No signing secret configured anywhere (DB-only). We cannot verify the
  // signature, so return the untrusted payload as unverified — the caller will
  // acknowledge and skip side effects (verify-session is authoritative).
  if (!webhookSecret) {
    return { verified: false, event: payload };
  }

  // constructEvent verifies the HMAC using webhookSecret; the API key on the
  // client is not used for verification, but the SDK requires a non-empty key.
  const stripe = new Stripe(apiSecret || webhookSecret);
  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  return { verified: true, event };
}

async function upsertCandidateStripePrefs(tenantDb, userId, patch) {
  if (!tenantDb?.CandidateAccountSettings || !userId) return;
  const [prefs] = await tenantDb.CandidateAccountSettings.findOrCreate({
    where: { user_id: userId },
    defaults: { user_id: userId },
  });
  await prefs.update(patch);
}

export async function syncSubscriptionToCandidate(tenantDb, subscription) {
  const userId = Number(subscription?.metadata?.userId);
  if (!tenantDb || !userId) return;

  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;

  await upsertCandidateStripePrefs(tenantDb, userId, {
    stripe_customer_id:
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id || null,
    stripe_subscription_id: subscription.id,
    subscription_status: subscription.status,
    subscription_current_period_end: periodEnd,
  });
}

export async function notifyCandidatePaymentEvent(tenantDb, userId, { title, message, type }) {
  if (!tenantDb || !userId) return;
  await notifyUser(tenantDb, userId, {
    tenantDb,
    type: type || NotificationTypes.WARNING,
    priority: NotificationPriority.HIGH,
    title,
    message,
    actionType: "payment_update",
    entityType: "payment",
    sendEmail: true,
  }).catch(() => {});
}
