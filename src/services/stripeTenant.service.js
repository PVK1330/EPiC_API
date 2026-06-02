import Stripe from "stripe";
import { Op } from "sequelize";
import platformDb from "../models/index.js";
import { getTenantDb } from "./tenantDb.service.js";
import { notifyUser, NotificationTypes, NotificationPriority } from "./notification.service.js";
import { normalizeStorageRelativePath } from "../utils/storagePath.util.js";

export function toPublicAssetUrl(relativePath) {
  if (!relativePath) return null;
  if (String(relativePath).startsWith("http")) return relativePath;

  const base = (process.env.BASE_URL || process.env.API_BASE_URL || "").replace(/\/$/, "");
  let normalizedPath =
    normalizeStorageRelativePath(relativePath) || String(relativePath).replace(/\\/g, "/");

  // Rewrite secure storage paths to the safe public serving endpoint
  if (
    normalizedPath.startsWith("storage/private/organisations/") ||
    normalizedPath.startsWith("storage/private/platform/") ||
    normalizedPath.startsWith("storage/private/superadmin/")
  ) {
    normalizedPath = normalizedPath.replace(
      /^storage\/private\/(organisations|platform|superadmin)\//,
      "api/public/images/",
    );
  } else if (
    normalizedPath.startsWith("uploads/organisations/") ||
    normalizedPath.startsWith("uploads/platform/") ||
    normalizedPath.startsWith("uploads/superadmin/")
  ) {
    // Backwards compatibility for legacy DB paths
    normalizedPath = normalizedPath.replace(
      /^uploads\/(organisations|platform|superadmin)\//,
      "api/public/images/",
    );
  } else if (normalizedPath.startsWith("api/public/images/")) {
    // Already a public path — keep as-is
  }

  return base ? `${base}/${normalizedPath}` : `/${normalizedPath}`;
}

/** Load tenant payment row; falls back to env keys when DB empty. */
export async function getTenantPaymentSettings(tenantDb) {
  if (!tenantDb?.PaymentSetting) {
    return {
      stripe_secret_key: process.env.STRIPE_SECRET_KEY || null,
      stripe_public_key: process.env.STRIPE_PUBLIC_KEY || null,
      stripe_webhook_secret: process.env.STRIPE_WEBHOOK_SECRET || null,
    };
  }
  let row = await tenantDb.PaymentSetting.findOne();
  if (!row) {
    row = await tenantDb.PaymentSetting.create({});
  }
  const plain = row.toJSON ? row.toJSON() : row;
  return {
    ...plain,
    stripe_secret_key: plain.stripe_secret_key || process.env.STRIPE_SECRET_KEY || null,
    stripe_public_key: plain.stripe_public_key || process.env.STRIPE_PUBLIC_KEY || null,
    stripe_webhook_secret:
      plain.stripe_webhook_secret || process.env.STRIPE_WEBHOOK_SECRET || null,
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

export async function getPlatformPaymentSettings() {
  const keys = ['stripe_secret_key', 'stripe_public_key', 'stripe_webhook_secret'];
  const settings = await platformDb.PlatformSetting.findAll({
    where: { key: keys }
  });
  
  const map = {};
  for (const s of settings) map[s.key] = s.value;

  return {
    stripe_secret_key: map.stripe_secret_key || process.env.STRIPE_SECRET_KEY || null,
    stripe_public_key: map.stripe_public_key || process.env.STRIPE_PUBLIC_KEY || null,
    stripe_webhook_secret: map.stripe_webhook_secret || process.env.STRIPE_WEBHOOK_SECRET || null,
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
 * Verify webhook signature using tenant secret from metadata, else env fallback.
 */
export async function constructStripeWebhookEvent(rawBody, signature) {
  let payload;
  try {
    payload = JSON.parse(rawBody.toString());
  } catch {
    throw new Error("Invalid webhook payload");
  }

  const metaOrgId = payload?.data?.object?.metadata?.organisationId;
  let webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (metaOrgId) {
    const tenantDb = await resolveTenantDbByOrganisationId(metaOrgId);
    if (tenantDb) {
      const settings = await getTenantPaymentSettings(tenantDb);
      if (settings.stripe_webhook_secret) {
        webhookSecret = settings.stripe_webhook_secret;
      }
    }
  }

  if (!webhookSecret) {
    throw new Error(
      "Stripe webhook secret is not configured. Set stripe_webhook_secret in Admin → Payment Config or STRIPE_WEBHOOK_SECRET in env.",
    );
  }

  // Use platform fallback for webhook verification if tenant lacks it
  let stripeClientSecret = process.env.STRIPE_SECRET_KEY || "sk_placeholder";
  if (!metaOrgId) {
    const pSettings = await getPlatformPaymentSettings();
    if (pSettings.stripe_secret_key) stripeClientSecret = pSettings.stripe_secret_key;
    if (!webhookSecret && pSettings.stripe_webhook_secret) webhookSecret = pSettings.stripe_webhook_secret;
  }

  const stripe = new Stripe(stripeClientSecret);
  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  return event;
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
