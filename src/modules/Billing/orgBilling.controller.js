/**
 * orgBilling.controller.js
 * Org-admin self-service subscription renewal via Stripe Checkout.
 *
 * Reachable while the org is suspended because:
 *  - the routes use verifyToken only (platform-DB scoped, no attachTenantDb), and
 *  - verifyToken exempts /api/billing for an expired org admin.
 *
 * Subscription fees are charged on the PLATFORM Stripe account.
 */
import Stripe from "stripe";
import catchAsync from "../../utils/catchAsync.js";
import ApiResponse from "../../utils/apiResponse.js";
import platformDb from "../../models/index.js";
import { getPlatformPaymentSettings } from "../../services/stripeTenant.service.js";
import {
  getLatestSubscriptionForOrg,
  activateOrgSubscriptionAfterPayment,
} from "../../services/orgBilling.service.js";

function frontendBase() {
  return (process.env.FRONTEND_URL || "http://localhost:5173")
    .split(",")[0]
    .trim()
    .replace(/\/$/, "");
}

function serializeSubscription(subscription) {
  if (!subscription) return null;
  return {
    id: subscription.id,
    status: subscription.status,
    current_period_end: subscription.current_period_end,
    plan: subscription.plan
      ? {
          id: subscription.plan.id,
          name: subscription.plan.name,
          price: subscription.plan.price,
          currency: subscription.plan.currency,
          billing_cycle: subscription.plan.billing_cycle,
        }
      : null,
  };
}

/** GET /api/billing/subscription — current subscription + org status for the renewal page. */
export const getMySubscription = catchAsync(async (req, res) => {
  const orgId = req.user?.organisation_id;
  if (!orgId) return ApiResponse.badRequest(res, "No organisation on account");

  const subscription = await getLatestSubscriptionForOrg(orgId);
  const org = await platformDb.Organisation.findByPk(orgId, {
    attributes: ["id", "name", "status"],
  });

  return ApiResponse.success(res, "Subscription status", {
    organisation: org ? { id: org.id, name: org.name, status: org.status } : null,
    subscription: serializeSubscription(subscription),
    expired:
      org?.status === "suspended" || subscription?.status === "expired",
  });
});

/** POST /api/billing/checkout — create a Stripe Checkout session to pay & reactivate. */
export const createCheckoutSession = catchAsync(async (req, res) => {
  const orgId = req.user?.organisation_id;
  if (!orgId) return ApiResponse.badRequest(res, "No organisation on account");

  const subscription = await getLatestSubscriptionForOrg(orgId);
  if (!subscription || !subscription.plan) {
    return ApiResponse.badRequest(
      res,
      "No plan is assigned to your organisation. Please contact support.",
    );
  }

  const plan = subscription.plan;
  const price = Number(plan.price) || 0;
  const currency = (plan.currency || "GBP").toLowerCase();

  // Free plan — nothing to charge, activate immediately.
  if (price <= 0) {
    await activateOrgSubscriptionAfterPayment({
      organisationId: orgId,
      paymentRef: `free-${subscription.id}-${Date.now()}`,
      amount: 0,
      currency,
      paymentMethod: "free",
    });
    return ApiResponse.success(res, "Subscription activated", {
      activated: true,
    });
  }

  const settings = await getPlatformPaymentSettings();
  if (!settings.stripe_secret_key) {
    return ApiResponse.error(
      res,
      "Online payment is not configured. Please contact support to activate your subscription.",
      503,
    );
  }

  const stripe = new Stripe(settings.stripe_secret_key);
  const base = frontendBase();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency,
          product_data: {
            name: `${plan.name} subscription`,
            description: `Reactivate your organisation subscription (${plan.billing_cycle})`,
          },
          unit_amount: Math.round(price * 100),
        },
        quantity: 1,
      },
    ],
    success_url: `${base}/admin/subscription?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/admin/subscription?payment=cancelled`,
    // NOTE: deliberately NOT keyed `organisationId` — that key routes webhook
    // verification to a tenant secret. This is a platform-account charge, so it
    // must verify with the platform webhook secret.
    metadata: {
      type: "org_subscription",
      subOrganisationId: String(orgId),
      subscriptionId: String(subscription.id),
    },
  });

  return ApiResponse.success(res, "Checkout session created", {
    url: session.url,
    session_id: session.id,
  });
});

/** POST /api/billing/verify-session/:sessionId — authoritative post-redirect activation. */
export const verifySession = catchAsync(async (req, res) => {
  const orgId = req.user?.organisation_id;
  const { sessionId } = req.params;
  if (!sessionId) return ApiResponse.badRequest(res, "sessionId is required");

  const settings = await getPlatformPaymentSettings();
  if (!settings.stripe_secret_key) {
    return ApiResponse.error(res, "Online payment is not configured.", 503);
  }
  const stripe = new Stripe(settings.stripe_secret_key);

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"],
  });

  if (
    session.metadata?.type !== "org_subscription" ||
    String(session.metadata?.subOrganisationId || "") !== String(orgId)
  ) {
    return ApiResponse.forbidden(
      res,
      "This payment session does not belong to your organisation",
    );
  }

  if (session.payment_status !== "paid") {
    return ApiResponse.success(res, "Payment not completed yet", {
      paid: false,
      payment_status: session.payment_status,
    });
  }

  const paymentIntentId =
    typeof session.payment_intent === "object"
      ? session.payment_intent?.id
      : session.payment_intent || null;

  const { subscription } = await activateOrgSubscriptionAfterPayment({
    organisationId: orgId,
    paymentRef: session.id,
    amount: session.amount_total != null ? session.amount_total / 100 : undefined,
    currency: session.currency,
    paymentIntentId,
  });

  return ApiResponse.success(res, "Subscription activated", {
    paid: true,
    subscription: serializeSubscription(subscription),
  });
});
