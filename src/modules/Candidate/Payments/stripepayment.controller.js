import Stripe from 'stripe';
import { Op } from 'sequelize';
import { notifyPaymentReceived } from '../../../services/notification.service.js';
import { createWorkflowTask } from '../../../services/workflowTaskAutomation.service.js';
import { evaluateCaseStageAfterEvent } from '../../../services/caseStageAutomation.service.js';
import platformDb from '../../../models/index.js';
import { getTenantDb } from '../../../services/tenantDb.service.js';

async function getActiveAdminIds(tenantDb) {
  const adminRole = await tenantDb.Role.findOne({
    where: { name: { [Op.iLike]: 'admin' } },
    attributes: ['id'],
  });
  if (!adminRole) return [];
  const admins = await tenantDb.User.findAll({
    where: { role_id: adminRole.id, status: 'active' },
    attributes: ['id'],
  });
  return admins.map((a) => a.id);
}

async function notifyAdminsOfPaymentReceived({ tenantDb, caseRecord, organisationId }) {
  const adminIds = await getActiveAdminIds(tenantDb);
  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
  for (const adminId of adminIds) {
    await createWorkflowTask({
      tenantDb,
      caseRecord,
      assigneeId: adminId,
      title: `Review payment received — ${caseLabel}`,
      priority: 'high',
      dueInDays: 1,
      organisationId: organisationId ?? null,
    }).catch(() => {});
  }
}

async function findCasePaymentByTransaction(tenantDb, transactionId) {
  if (!transactionId || !tenantDb?.CasePayment) return null;
  return tenantDb.CasePayment.findOne({ where: { transactionId: String(transactionId) } });
}

async function resolveCandidateCaseForPayment(tenantDb, userId) {
  if (!tenantDb || !userId) return { ok: false, status: 400, message: 'Unauthorized' };

  const caseRecord = await tenantDb.Case.findOne({
    where: { candidateId: userId },
    order: [['created_at', 'DESC']],
  });
  if (!caseRecord) {
    return { ok: false, status: 404, message: 'No case found for your account' };
  }

  const ccl = await tenantDb.CaseCclRecord.findOne({ where: { caseId: caseRecord.id } });
  const payableStatuses = new Set(['issued', 'signed', 'accepted']);
  if (!ccl || !payableStatuses.has(ccl.status)) {
    return {
      ok: false,
      status: 400,
      message:
        'Online payment is available after your caseworker proposes fees and an administrator approves your Client Care Letter.',
    };
  }

  const totalFee = Number(ccl.feeAmount) || Number(caseRecord.totalAmount) || 0;
  const paidAmount = Number(caseRecord.paidAmount) || 0;
  const balanceDue = Math.max(0, totalFee - paidAmount);

  return { ok: true, caseRecord, ccl, totalFee, paidAmount, balanceDue };
}

async function recordStripeCasePayment({ tenantDb, caseRecord, paymentIntent, userId, organisationId }) {
  const txnId = paymentIntent?.id;
  if (!txnId) return null;

  const existing = await findCasePaymentByTransaction(tenantDb, txnId);
  if (existing) {
    await caseRecord.reload();
    return existing;
  }

  const amount = paymentIntent.amount / 100;
  const paymentStatus = paymentIntent.status === 'succeeded' ? 'completed' : 'pending';

  const casePayment = await tenantDb.CasePayment.create({
    caseId: caseRecord.id,
    paymentType: 'fee',
    amount,
    paymentMethod: 'online',
    paymentDate: new Date().toISOString().split('T')[0],
    paymentStatus,
    transactionId: txnId,
    invoiceNumber: txnId,
    description: 'Stripe payment',
    receivedBy: userId || null,
  });

  if (paymentStatus === 'completed') {
    const prevPaid = Number(caseRecord.paidAmount) || 0;
    const newPaid = prevPaid + amount;
    const total = Number(caseRecord.totalAmount) || 0;
    const updates = { paidAmount: newPaid };
    if (total > 0 && newPaid >= total - 0.02) {
      updates.amountStatus = 'Paid';
    }
    await caseRecord.update(updates);
    await caseRecord.reload();

    await evaluateCaseStageAfterEvent({
      tenantDb,
      caseRecord,
      trigger: 'payment_received',
      performedBy: userId || null,
      organisationId: organisationId ?? null,
    }).catch(() => {});

    await notifyAdminsOfPaymentReceived({ tenantDb, caseRecord, organisationId });
  }

  return casePayment;
}

async function finalizeStripePaymentForUser({ userId, paymentIntent, caseRef = null }) {
  if (!userId || !paymentIntent?.id) return null;

  const tenantDb = await resolveTenantDbForUser(userId);
  if (!tenantDb) return null;

  let caseRecord = null;
  if (caseRef) {
    const numeric = parseInt(caseRef, 10);
    caseRecord =
      (await tenantDb.Case.findOne({ where: { caseId: String(caseRef) } })) ||
      (!Number.isNaN(numeric) ? await tenantDb.Case.findByPk(numeric) : null);
  }
  if (!caseRecord) {
    caseRecord = await tenantDb.Case.findOne({
      where: { candidateId: userId },
      order: [['created_at', 'DESC']],
    });
  }
  if (!caseRecord) return null;

  const user = await platformDb.User.findByPk(userId, { attributes: ['organisation_id'] });
  const organisationId = user?.organisation_id ?? null;

  if (paymentIntent.status !== 'succeeded') return null;

  const recorded = await recordStripeCasePayment({
    tenantDb,
    caseRecord,
    paymentIntent,
    userId,
    organisationId,
  });

  await notifyPaymentReceived(tenantDb, userId, {
    id: paymentIntent.id,
    invoiceId: paymentIntent.id,
    amount: paymentIntent.amount / 100,
    caseId: caseRecord.caseId || 'your case',
  }).catch(() => {});

  return { tenantDb, caseRecord, recorded };
}

let stripeInstance = null;

const getStripe = () => {
  if (!stripeInstance) {
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeInstance;
};

const resolveTenantDbForUser = async (userId) => {
  if (!userId) return null;
  const user = await platformDb.User.findByPk(userId, { attributes: ['organisation_id'] });
  if (!user?.organisation_id) return null;
  const org = await platformDb.Organisation.findByPk(user.organisation_id, { attributes: ['database_name'] });
  if (!org?.database_name) return null;
  return getTenantDb(org.database_name);
};

// Create Payment Intent (optional amount — defaults to case balance due)
export const createPaymentIntent = async (req, res) => {
  try {
    const stripe = getStripe();
    const {
      amount: bodyAmount,
      currency = "gbp",
      payment_method_id,
      metadata = {},
    } = req.body;

    const userId = req.user?.userId;
    const tenantDb = req.tenantDb;
    let payAmount = bodyAmount ? Number(bodyAmount) : null;
    let caseMeta = {};

    if (tenantDb && userId) {
      const resolved = await resolveCandidateCaseForPayment(tenantDb, userId);
      if (!resolved.ok) {
        return res.status(resolved.status).json({
          status: "error",
          message: resolved.message,
          data: null,
        });
      }
      if (!payAmount || payAmount <= 0) payAmount = resolved.balanceDue;
      caseMeta = {
        caseId: resolved.caseRecord.caseId,
        numericCaseId: String(resolved.caseRecord.id),
      };
    }

    if (!payAmount || payAmount < 0.5) {
      return res.status(400).json({
        status: "error",
        message: "No balance due or amount below minimum (£0.50)",
        data: null,
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(payAmount * 100),
      currency: currency.toLowerCase(),
      payment_method: payment_method_id,
      confirmation_method: "manual",
      confirm: payment_method_id ? true : false,
      metadata: {
        userId: userId ? String(userId) : "",
        ...caseMeta,
        ...metadata,
      },
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },
    });

    res.status(200).json({
      status: "success",
      message: "Payment intent created successfully",
      data: {
        client_secret: paymentIntent.client_secret,
        payment_intent_id: paymentIntent.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: paymentIntent.status,
      },
    });
  } catch (error) {
    console.error("Stripe Payment Intent Error:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to create payment intent",
      data: null,
    });
  }
};

/** Candidate: Stripe Checkout for approved CCL balance */
export const createCaseCheckoutSession = async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({
        status: "error",
        message: "Stripe is not configured on the server",
        data: null,
      });
    }

    const stripe = getStripe();
    const userId = req.user?.userId;
    const tenantDb = req.tenantDb;
    const resolved = await resolveCandidateCaseForPayment(tenantDb, userId);
    if (!resolved.ok) {
      return res.status(resolved.status).json({
        status: "error",
        message: resolved.message,
        data: null,
      });
    }

    const { caseRecord, balanceDue } = resolved;
    if (balanceDue < 0.5) {
      return res.status(400).json({
        status: "error",
        message: "No outstanding balance on this case",
        data: null,
      });
    }

    const frontend = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: `Case fees — ${caseRecord.caseId || caseRecord.id}`,
              description: "Approved Client Care Letter fees",
            },
            unit_amount: Math.round(balanceDue * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${frontend}/candidate/payments?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontend}/candidate/payments?payment=cancelled`,
      metadata: {
        userId: String(userId),
        caseId: caseRecord.caseId || String(caseRecord.id),
        numericCaseId: String(caseRecord.id),
      },
    });

    res.status(200).json({
      status: "success",
      message: "Checkout session created",
      data: {
        url: session.url,
        session_id: session.id,
        amount: balanceDue,
        currency: "gbp",
      },
    });
  } catch (error) {
    console.error("Stripe Checkout Session Error:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to create checkout session",
      data: null,
    });
  }
};

/** After redirect from Stripe Checkout — record payment if webhook has not run yet */
export const verifyCheckoutSession = async (req, res) => {
  try {
    const stripe = getStripe();
    const { session_id } = req.params;
    const userId = req.user?.userId;

    if (!session_id) {
      return res.status(400).json({
        status: "error",
        message: "session_id is required",
        data: null,
      });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["payment_intent"],
    });

    if (String(session.metadata?.userId || "") !== String(userId)) {
      return res.status(403).json({
        status: "error",
        message: "This payment session does not belong to your account",
        data: null,
      });
    }

    if (session.payment_status !== "paid") {
      return res.status(200).json({
        status: "success",
        message: "Payment not completed yet",
        data: { paid: false, payment_status: session.payment_status },
      });
    }

    const paymentIntent =
      typeof session.payment_intent === "object"
        ? session.payment_intent
        : await stripe.paymentIntents.retrieve(session.payment_intent);

    const result = await finalizeStripePaymentForUser({
      userId,
      paymentIntent,
      caseRef: session.metadata?.caseId,
    });

    const caseRecord = result?.caseRecord;
    const totalFee = Number(caseRecord?.totalAmount) || 0;
    const paidAmount = Number(caseRecord?.paidAmount) || 0;

    res.status(200).json({
      status: "success",
      message: "Payment verified",
      data: {
        paid: true,
        totalFee,
        paidAmount,
        balanceDue: Math.max(0, totalFee - paidAmount),
        caseStage: caseRecord?.caseStage,
        amountStatus: caseRecord?.amountStatus,
      },
    });
  } catch (error) {
    console.error("verifyCheckoutSession:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to verify checkout session",
      data: null,
    });
  }
};

// Confirm Payment
export const confirmPayment = async (req, res) => {
  try {
    const stripe = getStripe();
    const { payment_intent_id, payment_method_id } = req.body;

    if (!payment_intent_id) {
      return res.status(400).json({
        status: "error",
        message: "Payment intent ID is required",
        data: null,
      });
    }

    // Retrieve payment intent
    const paymentIntent =
      await stripe.paymentIntents.retrieve(payment_intent_id);

    if (paymentIntent.status === "succeeded") {
      await finalizeStripePaymentForUser({
        userId: req.user?.userId,
        paymentIntent,
        caseRef: paymentIntent.metadata?.caseId,
      }).catch(() => {});

      return res.status(200).json({
        status: "success",
        message: "Payment already confirmed",
        data: {
          payment_intent_id: paymentIntent.id,
          status: paymentIntent.status,
          amount: paymentIntent.amount,
        },
      });
    }

    const confirmedPayment = await stripe.paymentIntents.confirm(
      payment_intent_id,
      {
        payment_method: payment_method_id,
      },
    );

    if (confirmedPayment.status === "succeeded") {
      await finalizeStripePaymentForUser({
        userId: req.user?.userId,
        paymentIntent: confirmedPayment,
        caseRef: confirmedPayment.metadata?.caseId,
      }).catch(() => {});
    }

    res.status(200).json({
      status: "success",
      message: "Payment confirmed successfully",
      data: {
        payment_intent_id: confirmedPayment.id,
        status: confirmedPayment.status,
        amount: confirmedPayment.amount,
        currency: confirmedPayment.currency,
        receipt_email: confirmedPayment.receipt_email,
      },
    });
  } catch (error) {
    console.error("Stripe Payment Confirmation Error:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to confirm payment",
      data: null,
    });
  }
};

// Get Payment Status
export const getPaymentStatus = async (req, res) => {
  try {
    const stripe = getStripe();
    const { payment_intent_id } = req.params;

    if (!payment_intent_id) {
      return res.status(400).json({
        status: "error",
        message: "Payment intent ID is required",
        data: null,
      });
    }

    const paymentIntent =
      await stripe.paymentIntents.retrieve(payment_intent_id);

    if (paymentIntent.status === "succeeded") {
      await finalizeStripePaymentForUser({
        userId: req.user?.userId,
        paymentIntent,
        caseRef: paymentIntent.metadata?.caseId,
      }).catch(() => {});
    }

    res.status(200).json({
      status: "success",
      message: "Payment status retrieved successfully",
      data: {
        payment_intent_id: paymentIntent.id,
        status: paymentIntent.status,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        created: paymentIntent.created,
        metadata: paymentIntent.metadata,
        charges: paymentIntent.charges?.data || [],
      },
    });
  } catch (error) {
    console.error("Stripe Payment Status Error:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to retrieve payment status",
      data: null,
    });
  }
};

// Cancel Payment
export const cancelPayment = async (req, res) => {
  try {
    const stripe = getStripe();
    const { payment_intent_id } = req.body;

    if (!payment_intent_id) {
      return res.status(400).json({
        status: "error",
        message: "Payment intent ID is required",
        data: null,
      });
    }

    const canceledPayment =
      await stripe.paymentIntents.cancel(payment_intent_id);

    res.status(200).json({
      status: "success",
      message: "Payment canceled successfully",
      data: {
        payment_intent_id: canceledPayment.id,
        status: canceledPayment.status,
        amount: canceledPayment.amount,
      },
    });
  } catch (error) {
    console.error("Stripe Payment Cancellation Error:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to cancel payment",
      data: null,
    });
  }
};

// Create Setup Intent for saving payment methods
export const createSetupIntent = async (req, res) => {
  try {
    const stripe = getStripe();
    const { customer_id } = req.body;

    const setupIntent = await stripe.setupIntents.create({
      customer: customer_id,
      payment_method_types: ["card"],
      usage: "off_session",
    });

    res.status(200).json({
      status: "success",
      message: "Setup intent created successfully",
      data: {
        client_secret: setupIntent.client_secret,
        setup_intent_id: setupIntent.id,
      },
    });
  } catch (error) {
    console.error("Stripe Setup Intent Error:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to create setup intent",
      data: null,
    });
  }
};

// Stripe Webhook Handler
export const handleWebhook = async (req, res) => {
  const stripe = getStripe();
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.log(`Webhook signature verification failed.`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    // Payment Events
    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object;
      console.log("PaymentIntent was successful!", paymentIntent.id);
      if (paymentIntent.metadata?.userId) {
        try {
          const userId = Number(paymentIntent.metadata.userId);
          await finalizeStripePaymentForUser({
            userId,
            paymentIntent,
            caseRef: paymentIntent.metadata.caseId,
          });
        } catch (notifErr) {
          console.error("Failed to record payment_intent.succeeded:", notifErr);
        }
      }
      break;
    }

    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.payment_status === "paid" && session.metadata?.userId) {
        try {
          const userId = Number(session.metadata.userId);
          const stripe = getStripe();
          const paymentIntentId = session.payment_intent;
          if (paymentIntentId) {
            const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
            await finalizeStripePaymentForUser({
              userId,
              paymentIntent,
              caseRef: session.metadata.caseId,
            });
          }
        } catch (err) {
          console.error("Failed to record checkout.session.completed:", err);
        }
      }
      break;
    }

    case "payment_intent.payment_failed":
      const failedPayment = event.data.object;
      console.log("PaymentIntent failed!", failedPayment.id);
      // TODO: Handle failed payment, notify user, etc.
      break;

    case "payment_intent.canceled":
      const canceledPayment = event.data.object;
      console.log("PaymentIntent was canceled!", canceledPayment.id);
      // TODO: Handle canceled payment
      break;

    // Invoice Events
    case "invoice.payment_succeeded":
      const successInvoice = event.data.object;
      console.log("Invoice payment succeeded!", successInvoice.id);
      // TODO: Handle successful invoice payment, extend subscription
      break;

    case "invoice.payment_failed":
      const failedInvoice = event.data.object;
      console.log("Invoice payment failed!", failedInvoice.id);
      // TODO: Handle failed invoice payment, notify user
      break;

    case "invoice.upcoming":
      const upcomingInvoice = event.data.object;
      console.log("Invoice upcoming!", upcomingInvoice.id);
      // TODO: Send payment reminder email
      break;

    // Subscription Events
    case "customer.subscription.created":
      const createdSubscription = event.data.object;
      console.log("Subscription created!", createdSubscription.id);
      // TODO: Handle new subscription, update database
      break;

    case "customer.subscription.updated":
      const updatedSubscription = event.data.object;
      console.log("Subscription updated!", updatedSubscription.id);
      // TODO: Handle subscription changes, update database
      break;

    case "customer.subscription.deleted":
      const deletedSubscription = event.data.object;
      console.log("Subscription deleted!", deletedSubscription.id);
      // TODO: Handle subscription cancellation, update database
      break;

    case "customer.subscription.trial_will_end":
      const trialEnding = event.data.object;
      console.log("Trial ending soon!", trialEnding.id);
      // TODO: Send trial ending reminder
      break;

    // Customer Events
    case "customer.created":
      const customer = event.data.object;
      console.log("Customer created!", customer.id);
      // TODO: Handle new customer creation
      break;

    case "customer.updated":
      const updatedCustomer = event.data.object;
      console.log("Customer updated!", updatedCustomer.id);
      // TODO: Handle customer updates
      break;

    case "customer.deleted":
      const deletedCustomer = event.data.object;
      console.log("Customer deleted!", deletedCustomer.id);
      // TODO: Handle customer deletion
      break;

    // Setup Intent Events
    case "setup_intent.created":
      const setupIntent = event.data.object;
      console.log("Setup intent created!", setupIntent.id);
      break;

    case "setup_intent.succeeded":
      const succeededSetup = event.data.object;
      console.log("Setup intent succeeded!", succeededSetup.id);
      // TODO: Handle successful setup intent
      break;

    case "setup_intent.failed":
      const failedSetup = event.data.object;
      console.log("Setup intent failed!", failedSetup.id);
      // TODO: Handle failed setup intent
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  // Return a 200 response to acknowledge receipt of the event
  res.json({ received: true });
};

// Refund Payment
export const createRefund = async (req, res) => {
  try {
    const stripe = getStripe();
    const { payment_intent_id, amount, reason } = req.body;

    if (!payment_intent_id) {
      return res.status(400).json({
        status: "error",
        message: "Payment intent ID is required",
        data: null,
      });
    }

    const refund = await stripe.refunds.create({
      payment_intent: payment_intent_id,
      amount: amount ? Math.round(amount * 100) : undefined, // Convert to cents if provided
      reason: reason || "requested_by_customer",
    });

    res.status(200).json({
      status: "success",
      message: "Refund created successfully",
      data: {
        refund_id: refund.id,
        amount: refund.amount,
        currency: refund.currency,
        status: refund.status,
        receipt_url: refund.receipt_url,
      },
    });
  } catch (error) {
    console.error("Stripe Refund Error:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to create refund",
      data: null,
    });
  }
};

// Create Subscription
export const createSubscription = async (req, res) => {
  try {
    const stripe = getStripe();
    const {
      customer_id,
      price_id,
      payment_method_id,
      metadata = {},
    } = req.body;

    if (!customer_id || !price_id) {
      return res.status(400).json({
        status: "error",
        message: "Customer ID and Price ID are required",
        data: null,
      });
    }

    // Attach payment method to customer if provided
    if (payment_method_id) {
      await stripe.paymentMethods.attach(payment_method_id, {
        customer: customer_id,
      });

      // Set as default payment method
      await stripe.customers.update(customer_id, {
        invoice_settings: {
          default_payment_method: payment_method_id,
        },
      });
    }

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customer_id,
      items: [{ price: price_id }],
      payment_behavior: "default_incomplete",
      payment_settings: {
        save_default_payment_method: "on_subscription",
        payment_method_types: ["card"],
      },
      expand: ["latest_invoice.payment_intent"],
      metadata: {
        userId: req.user?.userId || null,
        ...metadata,
      },
    });

    res.status(200).json({
      status: "success",
      message: "Subscription created successfully",
      data: {
        subscription_id: subscription.id,
        client_secret: subscription.latest_invoice.payment_intent.client_secret,
        status: subscription.status,
        current_period_start: subscription.current_period_start,
        current_period_end: subscription.current_period_end,
        latest_invoice_id: subscription.latest_invoice.id,
      },
    });
  } catch (error) {
    console.error("Stripe Subscription Creation Error:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to create subscription",
      data: null,
    });
  }
};

// Renew Subscription
export const renewSubscription = async (req, res) => {
  try {
    const stripe = getStripe();
    const { subscription_id, payment_method_id } = req.body;

    if (!subscription_id) {
      return res.status(400).json({
        status: "error",
        message: "Subscription ID is required",
        data: null,
      });
    }

    // Retrieve the subscription
    const subscription = await stripe.subscriptions.retrieve(subscription_id);

    if (subscription.status === "active") {
      return res.status(400).json({
        status: "error",
        message: "Subscription is already active",
        data: {
          subscription_id: subscription.id,
          status: subscription.status,
          current_period_end: subscription.current_period_end,
        },
      });
    }

    // If payment method provided, update it
    if (payment_method_id) {
      await stripe.paymentMethods.attach(payment_method_id, {
        customer: subscription.customer,
      });

      await stripe.customers.update(subscription.customer, {
        invoice_settings: {
          default_payment_method: payment_method_id,
        },
      });
    }

    // Resume/renew the subscription
    const renewedSubscription = await stripe.subscriptions.update(
      subscription_id,
      {
        payment_behavior: "default_incomplete",
        expand: ["latest_invoice.payment_intent"],
      },
    );

    res.status(200).json({
      status: "success",
      message: "Subscription renewed successfully",
      data: {
        subscription_id: renewedSubscription.id,
        status: renewedSubscription.status,
        current_period_start: renewedSubscription.current_period_start,
        current_period_end: renewedSubscription.current_period_end,
        client_secret:
          renewedSubscription.latest_invoice?.payment_intent?.client_secret,
        latest_invoice_id: renewedSubscription.latest_invoice?.id,
      },
    });
  } catch (error) {
    console.error("Stripe Subscription Renewal Error:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to renew subscription",
      data: null,
    });
  }
};

// Cancel Subscription
export const cancelSubscription = async (req, res) => {
  try {
    const stripe = getStripe();
    const { subscription_id, cancel_at_period_end = true } = req.body;

    if (!subscription_id) {
      return res.status(400).json({
        status: "error",
        message: "Subscription ID is required",
        data: null,
      });
    }

    const canceledSubscription = await stripe.subscriptions.update(
      subscription_id,
      {
        cancel_at_period_end: cancel_at_period_end,
      },
    );

    res.status(200).json({
      status: "success",
      message: cancel_at_period_end
        ? "Subscription will be canceled at the end of the current period"
        : "Subscription canceled immediately",
      data: {
        subscription_id: canceledSubscription.id,
        status: canceledSubscription.status,
        cancel_at_period_end: canceledSubscription.cancel_at_period_end,
        current_period_end: canceledSubscription.current_period_end,
        canceled_at: canceledSubscription.canceled_at,
      },
    });
  } catch (error) {
    console.error("Stripe Subscription Cancellation Error:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to cancel subscription",
      data: null,
    });
  }
};

// Get Subscription Status
export const getSubscriptionStatus = async (req, res) => {
  try {
    const stripe = getStripe();
    const { subscription_id } = req.params;

    if (!subscription_id) {
      return res.status(400).json({
        status: "error",
        message: "Subscription ID is required",
        data: null,
      });
    }

    const subscription = await stripe.subscriptions.retrieve(subscription_id, {
      expand: ["latest_invoice", "customer.default_payment_method"],
    });

    res.status(200).json({
      status: "success",
      message: "Subscription status retrieved successfully",
      data: {
        subscription_id: subscription.id,
        status: subscription.status,
        current_period_start: subscription.current_period_start,
        current_period_end: subscription.current_period_end,
        cancel_at_period_end: subscription.cancel_at_period_end,
        canceled_at: subscription.canceled_at,
        ended_at: subscription.ended_at,
        trial_start: subscription.trial_start,
        trial_end: subscription.trial_end,
        customer: subscription.customer,
        items: subscription.items.data,
        latest_invoice: subscription.latest_invoice,
        metadata: subscription.metadata,
      },
    });
  } catch (error) {
    console.error("Stripe Subscription Status Error:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to retrieve subscription status",
      data: null,
    });
  }
};

// Update Subscription (change plan, quantity, etc.)
export const updateSubscription = async (req, res) => {
  try {
    const stripe = getStripe();
    const { subscription_id, price_id, quantity = 1, metadata = {} } = req.body;

    if (!subscription_id || !price_id) {
      return res.status(400).json({
        status: "error",
        message: "Subscription ID and Price ID are required",
        data: null,
      });
    }

    const updatedSubscription = await stripe.subscriptions.update(
      subscription_id,
      {
        items: [
          {
            id: (await stripe.subscriptions.retrieve(subscription_id)).items
              .data[0].id,
            price: price_id,
            quantity: quantity,
          },
        ],
        metadata: {
          ...metadata,
        },
      },
    );

    res.status(200).json({
      status: "success",
      message: "Subscription updated successfully",
      data: {
        subscription_id: updatedSubscription.id,
        status: updatedSubscription.status,
        current_period_start: updatedSubscription.current_period_start,
        current_period_end: updatedSubscription.current_period_end,
        items: updatedSubscription.items.data,
      },
    });
  } catch (error) {
    console.error("Stripe Subscription Update Error:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to update subscription",
      data: null,
    });
  }
};
