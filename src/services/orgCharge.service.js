/**
 * orgCharge.service.js
 * Single source of truth for what an organisation actually pays to activate /
 * renew its subscription on the PLATFORM Stripe account.
 *
 * The professional total is:
 *     subtotal = plan price + platform fee
 *     total    = subtotal + VAT
 *
 * - platform_fee is a PERCENT of the plan price (superadmin → Settings → Commerce),
 *   stored in PlatformSetting.platform_fee.
 * - tax_rate is a PERCENT (e.g. "20" for UK VAT), stored in PlatformSetting.tax_rate,
 *   applied on the subtotal — the same formula already used by the receipt/invoice
 *   PDFs (taxAmount = net * tax_rate/100), centralised here so checkout, the pay
 *   page, and the persisted invoice always agree.
 *
 * All amounts are returned in MAJOR currency units (e.g. pounds), rounded to 2dp.
 */
import platformDb from "../models/index.js";

/** Round to 2 decimal places, dodging binary float drift (e.g. 1.005 → 1.01). */
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function toPercent(raw) {
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Self-defending cap: a fee/VAT percent can never exceed 100, regardless of how
  // the PlatformSetting value got into the DB (legacy row, seed, manual edit).
  return Math.min(100, n);
}

/**
 * Read the superadmin-configured charge settings (platform fee %, VAT %, tax id,
 * default currency) from PlatformSetting. These are the same rows written by
 * configureGateway (Settings → Commerce).
 */
export async function getPlatformChargeSettings() {
  const rows = await platformDb.PlatformSetting.findAll({
    where: { key: ["platform_fee", "tax_rate", "tax_id", "stripe_currency"] },
  });
  const map = {};
  for (const r of rows) map[r.key] = r.value;

  return {
    platformFeePercent: toPercent(map.platform_fee),
    taxRatePercent: toPercent(map.tax_rate),
    taxId: map.tax_id ? String(map.tax_id).trim() : null,
    currency: (map.stripe_currency || "GBP").toUpperCase(),
  };
}

/**
 * Compute the full charge breakdown for a plan.
 *
 * @param {Object} p
 * @param {number|string} p.planPrice  Plan price in major units
 * @param {string} [p.currency]        Override currency (defaults to plan/stripe currency)
 * @param {Object} [p.settings]        Pre-loaded getPlatformChargeSettings() (avoids a re-read)
 * @returns {Promise<{
 *   planPrice:number, platformFeePercent:number, platformFee:number,
 *   subtotal:number, taxRatePercent:number, taxAmount:number, total:number,
 *   taxId:(string|null), currency:string
 * }>}
 */
export async function computeOrgCharge({ planPrice, currency, settings } = {}) {
  const cfg = settings || (await getPlatformChargeSettings());
  const price = round2(Math.max(0, Number(planPrice) || 0));

  const platformFee = round2(price * (cfg.platformFeePercent / 100));
  const subtotal = round2(price + platformFee);
  const taxAmount = round2(subtotal * (cfg.taxRatePercent / 100));
  const total = round2(subtotal + taxAmount);

  return {
    planPrice: price,
    platformFeePercent: cfg.platformFeePercent,
    platformFee,
    subtotal,
    taxRatePercent: cfg.taxRatePercent,
    taxAmount,
    total,
    taxId: cfg.taxId,
    currency: (currency || cfg.currency || "GBP").toUpperCase(),
  };
}

/**
 * Build Stripe Checkout line_items from a computed charge. Itemised so the
 * customer sees subscription + platform fee + VAT separately. Zero-value
 * components are omitted (Stripe rejects/clutters with £0 lines).
 *
 * @param {Object} charge   result of computeOrgCharge()
 * @param {Object} plan     the plan (for naming)
 * @returns {Array} Stripe line_items
 */
export function buildChargeLineItems(charge, plan) {
  const currency = (charge.currency || "GBP").toLowerCase();
  const items = [];

  if (charge.planPrice > 0) {
    items.push({
      price_data: {
        currency,
        product_data: {
          name: `${plan?.name || "Subscription"} subscription`,
          description: `Organisation subscription (${plan?.billing_cycle || "monthly"})`,
        },
        unit_amount: Math.round(charge.planPrice * 100),
      },
      quantity: 1,
    });
  }

  if (charge.platformFee > 0) {
    items.push({
      price_data: {
        currency,
        product_data: {
          name: `Platform fee (${charge.platformFeePercent}%)`,
        },
        unit_amount: Math.round(charge.platformFee * 100),
      },
      quantity: 1,
    });
  }

  if (charge.taxAmount > 0) {
    items.push({
      price_data: {
        currency,
        product_data: {
          name: `VAT (${charge.taxRatePercent}%)`,
        },
        unit_amount: Math.round(charge.taxAmount * 100),
      },
      quantity: 1,
    });
  }

  return items;
}
