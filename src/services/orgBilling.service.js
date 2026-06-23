/**
 * orgBilling.service.js
 * Org-admin self-service subscription billing (platform DB).
 *
 * Subscription fees are collected on the PLATFORM Stripe account (see
 * getPlatformPaymentSettings) — distinct from the tenant-scoped candidate
 * payments. Activation is idempotent, keyed on the Stripe checkout session id,
 * so a webhook and the post-redirect verify-session call cannot double-bill or
 * double-extend the period.
 */
import platformDb from "../models/index.js";
import { invalidateOrgCache } from "./orgCache.service.js";
import { computeOrgCharge } from "./orgCharge.service.js";
import logger from "../utils/logger.js";

/** Most recent subscription (any status) for an org, with its plan. */
export async function getLatestSubscriptionForOrg(organisationId, options = {}) {
  if (!organisationId) return null;
  return platformDb.Subscription.findOne({
    where: { organisation_id: organisationId },
    include: [{ model: platformDb.Plan, as: "plan" }],
    order: [["createdAt", "DESC"]],
    ...options,
  });
}

function computeNextPeriodEnd(plan, from) {
  const end = new Date(from);
  if (plan?.billing_cycle === "yearly") {
    end.setFullYear(end.getFullYear() + 1);
  } else if (plan?.billing_cycle === "one-time") {
    // One-off plans don't really renew; give a long horizon so the gate passes.
    end.setFullYear(end.getFullYear() + 100);
  } else {
    end.setMonth(end.getMonth() + 1); // monthly (default)
  }
  return end;
}

/**
 * Manually reactivate a suspended/expired org WITHOUT taking a payment — for
 * superadmin "activate account" actions. Sets the latest subscription active and
 * extends its period (so the expiry cron doesn't immediately re-expire it), sets
 * the org active, and clears the cached org status so the change takes effect
 * immediately (the auth middleware caches org status for ~5 min).
 *
 * @param {number} organisationId
 * @returns {Promise<{subscription: object|null, organisation: object|null}>}
 */
export async function reactivateOrgManually(organisationId) {
  if (!organisationId) throw new Error("organisationId is required");

  const tx = await platformDb.sequelize.transaction();
  try {
    const subscription = await getLatestSubscriptionForOrg(organisationId, {
      transaction: tx,
    });

    const now = new Date();
    if (subscription) {
      const base =
        subscription.current_period_end &&
        new Date(subscription.current_period_end) > now
          ? new Date(subscription.current_period_end)
          : now;
      await subscription.update(
        {
          status: "active",
          current_period_start: subscription.current_period_start || now,
          current_period_end: computeNextPeriodEnd(subscription.plan, base),
        },
        { transaction: tx },
      );
    }

    const org = await platformDb.Organisation.findByPk(organisationId, {
      transaction: tx,
    });
    if (org && org.status !== "active") {
      await org.update({ status: "active" }, { transaction: tx });
    }

    await tx.commit();
    invalidateOrgCache(organisationId);
    logger.info({ organisationId }, "Org manually reactivated by platform staff");
    return { subscription, organisation: org };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

/**
 * Idempotently activate an org's subscription after a successful payment.
 * @param {Object} p
 * @param {number} p.organisationId
 * @param {string} p.paymentRef          Idempotency key (Stripe checkout session id, or a free-plan ref)
 * @param {number} [p.amount]            Amount paid (major units); falls back to plan price
 * @param {string} [p.currency]
 * @param {string|null} [p.paymentIntentId]
 * @param {string} [p.paymentMethod]
 * @param {object|null} [p.breakdown]   Charge breakdown snapshotted at checkout
 *   (planPrice/platformFeePercent/platformFee/subtotal/taxRatePercent/taxAmount/total).
 *   Persisted verbatim so the invoice ties to the exact gross charged; falls back
 *   to a fresh compute (free/legacy path) when absent.
 * @returns {Promise<{subscription: object|null, invoice?: object, alreadyProcessed: boolean}>}
 */
export async function activateOrgSubscriptionAfterPayment({
  organisationId,
  paymentRef,
  amount,
  currency = "GBP",
  paymentIntentId = null,
  paymentMethod = "card",
  breakdown = null,
}) {
  if (!organisationId || !paymentRef) {
    throw new Error("organisationId and paymentRef are required");
  }

  const tx = await platformDb.sequelize.transaction();
  try {
    const subscription = await getLatestSubscriptionForOrg(organisationId, {
      transaction: tx,
    });

    // Idempotency: this payment was already recorded — ensure active, then exit.
    const existingTxn = await platformDb.PaymentTransaction.findOne({
      where: { reference: paymentRef },
      transaction: tx,
    });
    if (existingTxn) {
      await tx.commit();
      return { subscription, alreadyProcessed: true };
    }

    if (!subscription) {
      throw new Error("No subscription on file for this organisation");
    }

    const plan = subscription.plan;
    const now = new Date();
    // Extend from the later of "now" and the existing period end so an early
    // renewal doesn't lose remaining time.
    const base =
      subscription.current_period_end &&
      new Date(subscription.current_period_end) > now
        ? new Date(subscription.current_period_end)
        : now;
    const newPeriodEnd = computeNextPeriodEnd(plan, base);
    const resolvedCurrency = (currency || plan?.currency || "GBP").toUpperCase();

    // Prefer the breakdown SNAPSHOTTED at checkout (it ties exactly to the gross
    // Stripe charged). Only fall back to a fresh compute for the free/legacy path
    // (no snapshot), where a recompute is harmless.
    const persisted =
      breakdown && breakdown.total != null
        ? {
            planPrice: Number(breakdown.planPrice) || 0,
            platformFeePercent: Number(breakdown.platformFeePercent) || 0,
            platformFee: Number(breakdown.platformFee) || 0,
            subtotal: Number(breakdown.subtotal) || 0,
            taxRatePercent: Number(breakdown.taxRatePercent) || 0,
            taxAmount: Number(breakdown.taxAmount) || 0,
            total: Number(breakdown.total) || 0,
          }
        : await computeOrgCharge({ planPrice: plan?.price, currency: resolvedCurrency });
    const resolvedAmount = amount != null ? amount : persisted.total;

    await subscription.update(
      {
        status: "active",
        current_period_start: now,
        current_period_end: newPeriodEnd,
      },
      { transaction: tx },
    );

    const org = await platformDb.Organisation.findByPk(organisationId, {
      transaction: tx,
    });
    if (org && org.status !== "active") {
      await org.update({ status: "active" }, { transaction: tx });
    }

    const lastInvoice = await platformDb.Invoice.findOne({
      order: [["id", "DESC"]],
      transaction: tx,
    });
    let nextNum = 10001;
    if (lastInvoice && lastInvoice.invoice_number) {
      const match = lastInvoice.invoice_number.match(/INV-(\d+)/);
      if (match) {
        nextNum = parseInt(match[1]) + 1;
      }
    }
    const invoiceNumber = `INV-${nextNum}`;

    const invoice = await platformDb.Invoice.create(
      {
        organisation_id: organisationId,
        subscription_id: subscription.id,
        invoice_number: invoiceNumber,
        amount: resolvedAmount,
        subtotal: persisted.subtotal,
        platform_fee_amount: persisted.platformFee,
        tax_rate: persisted.taxRatePercent,
        tax_amount: persisted.taxAmount,
        total: persisted.total,
        currency: resolvedCurrency,
        status: "paid",
        payment_method: paymentMethod,
        payment_gateway: "Stripe",
        stripe_payment_intent_id: paymentIntentId,
        paid_at: now,
      },
      { transaction: tx },
    );

    await platformDb.PaymentTransaction.create(
      {
        organisation_id: organisationId,
        invoice_id: invoice.id,
        reference: paymentRef,
        amount: resolvedAmount,
        currency: resolvedCurrency,
        status: "completed",
        payment_method: paymentMethod,
        gateway: "Stripe",
        gateway_reference: paymentIntentId || paymentRef,
        metadata: {
          type: "org_subscription",
          subscription_id: subscription.id,
          breakdown: {
            plan_price: persisted.planPrice,
            platform_fee_percent: persisted.platformFeePercent,
            platform_fee: persisted.platformFee,
            subtotal: persisted.subtotal,
            tax_rate: persisted.taxRatePercent,
            tax_amount: persisted.taxAmount,
            total: persisted.total,
          },
        },
      },
      { transaction: tx },
    );

    await tx.commit();
    invalidateOrgCache(organisationId);
    logger.info(
      { organisationId, subscriptionId: subscription.id },
      "Org subscription activated after payment",
    );
    return { subscription, invoice, alreadyProcessed: false };
  } catch (err) {
    await tx.rollback();
    // A concurrent writer (the other verify-session call, a double-click, or the
    // webhook) recorded this exact payment first and the PaymentTransaction
    // UNIQUE(reference) fired. That means activation already succeeded — surface
    // it as idempotent success, not a 500.
    if (err?.name === "SequelizeUniqueConstraintError") {
      const subscription = await getLatestSubscriptionForOrg(organisationId);
      invalidateOrgCache(organisationId);
      return { subscription, alreadyProcessed: true };
    }
    throw err;
  }
}
