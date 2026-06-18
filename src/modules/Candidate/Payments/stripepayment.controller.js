import logger from '../../../utils/logger.js';
import Stripe from 'stripe';
import { Op } from 'sequelize';
import path from 'path';
import { localDateStr } from '../../../utils/dateHelpers.js';
import catchAsync from '../../../utils/catchAsync.js';
import ApiResponse from '../../../utils/apiResponse.js';
import { generateBrandedPdfBuffer } from '../../../services/pdfGenerator.service.js';
import { notifyPaymentReceived, NotificationTypes } from '../../../services/notification.service.js';
import { createWorkflowTask } from '../../../services/workflowTaskAutomation.service.js';
import { evaluateCaseStageAfterEvent } from '../../../services/caseStageAutomation.service.js';
import {
  isCclReleasedToClient,
  resolveCaseFeeTotal,
  syncCclReleaseForApprovedFees,
} from '../../../services/cclCandidateRelease.service.js';
import platformDb from '../../../models/index.js';
import { getTenantDb } from '../../../services/tenantDb.service.js';
import { activateOrgSubscriptionAfterPayment } from '../../../services/orgBilling.service.js';
import {
  getStripeForRequest,
  getStripeForTenant,
  buildStripeMetadata,
  constructStripeWebhookEvent,
  resolveTenantDbFromStripeObject,
  syncSubscriptionToCandidate,
  notifyCandidatePaymentEvent,
} from '../../../services/stripeTenant.service.js';

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
    }).catch((err) => logger.warn({ err }, "BUG-005: create 'review payment received' admin task failed"));
  }
}

async function findCasePaymentByTransaction(tenantDb, transactionId, caseId = null) {
  if (!transactionId || !tenantDb?.CasePayment) return null;
  // BUG-015: when a caseId is known (the only safe context for a user-facing
  // lookup), scope the query to that case so a payment can never be read across
  // accounts by transaction id alone.
  const where = { transactionId: String(transactionId) };
  if (caseId != null) where.caseId = caseId;
  return tenantDb.CasePayment.findOne({ where });
}

async function resolveCandidateCaseForPayment(tenantDb, userId) {
  if (!tenantDb || !userId) return { ok: false, status: 400, message: 'Unauthorized' };

  let caseRecord = await tenantDb.Case.findOne({
    where: { candidateId: userId },
    order: [['created_at', 'DESC']],
  });
  if (!caseRecord) {
    return { ok: false, status: 404, message: 'No case found for your account' };
  }

  const { ccl: syncedCcl, caseRecord: syncedCase } = await syncCclReleaseForApprovedFees({
    tenantDb,
    caseRecord,
    performedBy: userId,
  });
  caseRecord = syncedCase || caseRecord;
  const ccl =
    syncedCcl ||
    (await tenantDb.CaseCclRecord.findOne({ where: { caseId: caseRecord.id } }));

  if (!isCclReleasedToClient(caseRecord, ccl)) {
    return {
      ok: false,
      status: 400,
      message:
        'Online payment is available after your caseworker proposes fees and an administrator approves your Client Care Letter.',
    };
  }

  const totalFee = resolveCaseFeeTotal(caseRecord, ccl);
  const paidAmount = Number(caseRecord.paidAmount) || 0;
  const balanceDue = Math.max(0, totalFee - paidAmount);

  return { ok: true, caseRecord, ccl, totalFee, paidAmount, balanceDue };
}

/**
 * After a payment, make sure the case's CCL record isn't stuck in a pre-approval
 * state. A candidate cannot reach payment without the fee being released, so a
 * record still reading fee_proposed/fee_rejected/pending is the symptom of an
 * admin-approve step that never completed — promote it to "issued". Never
 * downgrades an already-signed/accepted record.
 */
async function reconcileCclRecordForPayment({ tenantDb, caseRecord, performedBy = null }) {
  if (!tenantDb?.CaseCclRecord || !caseRecord) return;
  const ccl = await tenantDb.CaseCclRecord.findOne({ where: { caseId: caseRecord.id } });
  if (!ccl) return;
  const status = String(ccl.status || '').toLowerCase();
  if (['fee_proposed', 'fee_rejected', 'pending'].includes(status)) {
    await ccl.update({
      status: 'issued',
      issuedAt: ccl.issuedAt || new Date(),
      issuedBy: ccl.issuedBy || performedBy,
      adminReviewedAt: ccl.adminReviewedAt || new Date(),
      adminReviewedBy: ccl.adminReviewedBy || performedBy,
    });
  }
}

async function recordStripeCasePayment({ tenantDb, caseRecord, paymentIntent, userId, organisationId }) {
  const txnId = paymentIntent?.id;
  if (!txnId) return null;

  const amount = paymentIntent.amount / 100;
  const paymentStatus = paymentIntent.status === 'succeeded' ? 'completed' : 'pending';

  // BUG-105: the checkout amount is server-enforced (unit_amount = balanceDue),
  // so the candidate cannot lower it through the normal flow. But if a recorded
  // amount comes in materially below the case's outstanding balance, surface it
  // as an auditable discrepancy rather than crediting silently. Partial/instalment
  // payments are legitimate, so this warns (for reconciliation) without rejecting.
  {
    const outstanding = Math.max(0, (Number(caseRecord.totalAmount) || 0) - (Number(caseRecord.paidAmount) || 0));
    if (outstanding > 0 && amount + 0.02 < outstanding) {
      logger.warn(
        { caseId: caseRecord.id, paymentIntentId: txnId, amount, outstanding },
        'Stripe payment amount is below the outstanding balance — recording as a partial payment',
      );
    }
  }

  // BUG-104: finalisation is triggered from BOTH the Stripe webhook AND the
  // verifyCheckoutSession endpoint, which can fire concurrently for the same
  // paymentIntent. A plain find-then-create has a race window that lets both
  // callers create a CasePayment, double-crediting the case. Serialise the
  // check-and-insert inside a transaction that row-locks the case, and treat any
  // unique-constraint violation (defence-in-depth if a DB unique index on
  // transactionId is added later) as "already recorded".
  let created = false;
  let casePayment;
  try {
    casePayment = await tenantDb.sequelize.transaction(async (t) => {
      // Lock the case row so the two finalize paths serialise on it.
      await caseRecord.reload({ transaction: t, lock: t.LOCK.UPDATE });

      const existingInTxn = await tenantDb.CasePayment.findOne({
        where: { transactionId: String(txnId), caseId: caseRecord.id },
        transaction: t,
      });
      if (existingInTxn) return existingInTxn;

      created = true;
      return tenantDb.CasePayment.create(
        {
          caseId: caseRecord.id,
          paymentType: 'fee',
          amount,
          paymentMethod: 'online',
          paymentDate: localDateStr(),
          paymentStatus,
          transactionId: txnId,
          invoiceNumber: txnId,
          description: 'Stripe payment',
          receivedBy: userId || null,
        },
        { transaction: t },
      );
    });
  } catch (err) {
    if (err?.name === 'SequelizeUniqueConstraintError') {
      const existing = await findCasePaymentByTransaction(tenantDb, txnId, caseRecord.id);
      if (existing) {
        await caseRecord.reload();
        return existing;
      }
    }
    throw err;
  }

  // Already recorded by a concurrent caller — do not re-apply the balance update.
  if (!created) {
    await caseRecord.reload();
    return casePayment;
  }

  if (paymentStatus === 'completed') {
    const prevPaid = Number(caseRecord.paidAmount) || 0;
    const newPaid = prevPaid + amount;
    const total = Number(caseRecord.totalAmount) || 0;
    const fullyPaid = total > 0 && newPaid >= total - 0.02;
    const updates = { paidAmount: newPaid };
    if (fullyPaid) {
      updates.amountStatus = 'Paid';
    } else if (caseRecord.amountStatus === 'Pending Approval') {
      // A payment can only happen after the fee was effectively approved/released
      // to the client. If the case was still showing the caseworker's
      // "Pending Approval" (admin-approve never formally completed), reconcile it
      // to Approved so caseworker/admin/candidate views stop disagreeing.
      updates.amountStatus = 'Approved';
    }
    await caseRecord.update(updates);
    await caseRecord.reload();

    // Keep the CCL record consistent: a paid case must not still read as an
    // un-reviewed proposal. Promote a lingering fee_proposed/fee_rejected/pending
    // record to "issued" (released) so admin's pending-approvals list and the
    // candidate CCL view agree with the payment that just happened.
    await reconcileCclRecordForPayment({ tenantDb, caseRecord, performedBy: userId }).catch(
      (err) => logger.error({ err }, 'reconcileCclRecordForPayment'),
    );

    await evaluateCaseStageAfterEvent({
      tenantDb,
      caseRecord,
      trigger: 'payment_received',
      performedBy: userId || null,
      organisationId: organisationId ?? null,
    }).catch((err) => logger.warn({ err, caseId: caseRecord.id }, "BUG-005: evaluateCaseStageAfterEvent (payment_received) failed"));

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

  // BUG-108: only a 'succeeded' intent updates the balance, but a non-succeeded
  // status (processing / requires_action / requires_payment_method, etc.) must
  // not be dropped silently — log it so pending/stuck payments leave an audit
  // trail and can be reconciled.
  if (paymentIntent.status !== 'succeeded') {
    logger.warn(
      { userId, paymentIntentId: paymentIntent.id, status: paymentIntent.status, caseId: caseRecord.id },
      'Stripe payment finalisation skipped — payment intent not succeeded',
    );
    return null;
  }

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
  }).catch((err) =>
    // Payment is already recorded; a notification failure must not roll it back,
    // but it must be visible in logs (BUG-005).
    logger.error({ err, userId, paymentIntentId: paymentIntent.id }, 'Payment-received notification failed'),
  );

  return { tenantDb, caseRecord, recorded };
}

const resolveTenantDbForUser = async (userId) => {
  if (!userId) return null;
  const user = await platformDb.User.findByPk(userId, { attributes: ['organisation_id'] });
  if (!user?.organisation_id) return null;
  const org = await platformDb.Organisation.findByPk(user.organisation_id, { attributes: ['database_name'] });
  if (!org?.database_name) return null;
  return getTenantDb(org.database_name);
};

async function notifyAdminsOfBankTransferReported({ tenantDb, caseRecord, organisationId }) {
  const adminIds = await getActiveAdminIds(tenantDb);
  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
  for (const adminId of adminIds) {
    await createWorkflowTask({
      tenantDb,
      caseRecord,
      assigneeId: adminId,
      title: `Confirm bank transfer — ${caseLabel}`,
      priority: 'high',
      dueInDays: 2,
      organisationId: organisationId ?? null,
    }).catch((err) => logger.warn({ err }, "BUG-005: create 'confirm bank transfer' admin task failed"));
  }
}

// ── Bank transfer (candidate-facing) ──────────────────────────────────────────
/** Candidate: fetch the org's bank-transfer payee details + reference + amount due. */
export const getBankTransferDetails = async (req, res) => {
  try {
    const tenantDb = req.tenantDb;
    const userId = req.user?.userId;
    const resolved = await resolveCandidateCaseForPayment(tenantDb, userId);
    if (!resolved.ok) {
      return res.status(resolved.status).json({ status: 'error', message: resolved.message, data: null });
    }
    const setting = tenantDb.PaymentSetting ? await tenantDb.PaymentSetting.findOne() : null;
    const enabled = setting ? setting.pay_bank !== false : true;
    return res.status(200).json({
      status: 'success',
      data: {
        enabled,
        bankDetails: setting?.bank_details || '',
        currency: setting?.currency || 'GBP',
        reference: resolved.caseRecord.caseId || String(resolved.caseRecord.id),
        amountDue: resolved.balanceDue,
        totalFee: resolved.totalFee,
        paidAmount: resolved.paidAmount,
      },
    });
  } catch (err) {
    logger.error({ err }, 'getBankTransferDetails');
    res.status(500).json({ status: 'error', message: err.message, data: null });
  }
};

/** Candidate: notify the firm that a bank transfer has been made (admin confirms receipt). */
export const recordBankTransferIntent = async (req, res) => {
  try {
    const tenantDb = req.tenantDb;
    const userId = req.user?.userId;
    const resolved = await resolveCandidateCaseForPayment(tenantDb, userId);
    if (!resolved.ok) {
      return res.status(resolved.status).json({ status: 'error', message: resolved.message, data: null });
    }
    const { caseRecord, balanceDue } = resolved;
    const reqAmount = Number(req.body?.amount);
    const amount = Number.isFinite(reqAmount) && reqAmount > 0 ? reqAmount : balanceDue;
    const reference = caseRecord.caseId || String(caseRecord.id);

    // Re-use an existing pending bank-transfer record rather than stacking duplicates.
    let payment = await tenantDb.CasePayment.findOne({
      where: { caseId: caseRecord.id, paymentMethod: 'bank_transfer', paymentStatus: 'pending' },
    });
    if (!payment) {
      const note = req.body?.note ? `: ${String(req.body.note).slice(0, 200)}` : '';
      payment = await tenantDb.CasePayment.create({
        caseId: caseRecord.id,
        paymentType: 'fee',
        amount,
        paymentMethod: 'bank_transfer',
        paymentDate: localDateStr(),
        paymentStatus: 'pending',
        transactionId: `BT-${reference}-${Date.now()}`,
        invoiceNumber: `BT-${reference}`,
        description: `Bank transfer reported by candidate (awaiting confirmation)${note}`,
        receivedBy: null,
      });
    }

    const user = await platformDb.User.findByPk(userId, { attributes: ['organisation_id'] });
    await notifyAdminsOfBankTransferReported({
      tenantDb,
      caseRecord,
      organisationId: user?.organisation_id ?? null,
    }).catch((err) => logger.warn({ err, caseId: caseRecord.id }, "BUG-005: notifyAdminsOfBankTransferReported failed"));

    return res.status(200).json({
      status: 'success',
      message: 'Thank you. We will confirm your bank transfer once it has been received.',
      data: { paymentId: payment.id, reference, amount },
    });
  } catch (err) {
    logger.error({ err }, 'recordBankTransferIntent');
    res.status(500).json({ status: 'error', message: err.message, data: null });
  }
};

// Create Payment Intent (optional amount — defaults to case balance due)
export const createPaymentIntent = async (req, res) => {
  try {
    const { stripe } = await getStripeForRequest(req);
    const {
      amount: bodyAmount,
      currency = "gbp",
      payment_method_id,
      metadata = {},
    } = req.validated.body;

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
      metadata: buildStripeMetadata(req, {
        userId: userId ? String(userId) : "",
        ...caseMeta,
        ...metadata,
      }),
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
    logger.error({ err: error }, "Stripe Payment Intent Error");
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
    const { stripe, settings } = await getStripeForRequest(req);
    if (!settings.stripe_secret_key) {
      return res.status(503).json({
        status: "error",
        message: "Stripe is not configured for this organisation. Add keys in Admin → Payment Config.",
        data: null,
      });
    }
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
      metadata: buildStripeMetadata(req, {
        userId: String(userId),
        caseId: caseRecord.caseId || String(caseRecord.id),
        numericCaseId: String(caseRecord.id),
      }),
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
    logger.error({ err: error }, "Stripe Checkout Session Error");
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
    const { stripe } = await getStripeForRequest(req);
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
    logger.error({ err: error }, "verifyCheckoutSession");
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
    const { stripe } = await getStripeForRequest(req);
    const { payment_intent_id, payment_method_id } = req.validated.body;

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
      }).catch((err) =>
        logger.error({ err, paymentIntentId: paymentIntent.id }, "BUG-005: finalizeStripePaymentForUser failed"),
      );

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
      }).catch((err) =>
        logger.error({ err, paymentIntentId: confirmedPayment.id }, "BUG-005: finalizeStripePaymentForUser failed"),
      );
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
    logger.error({ err: error }, "Stripe Payment Confirmation Error");
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
    const { stripe } = await getStripeForRequest(req);
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
      }).catch((err) =>
        logger.error({ err, paymentIntentId: paymentIntent.id }, "BUG-005: finalizeStripePaymentForUser failed"),
      );
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
    logger.error({ err: error }, "Stripe Payment Status Error");
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
    const { stripe } = await getStripeForRequest(req);
    const { payment_intent_id } = req.validated.body;

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
    logger.error({ err: error }, "Stripe Payment Cancellation Error");
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
    const { stripe } = await getStripeForRequest(req);
    const { customer_id } = req.validated.body;

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
    logger.error({ err: error }, "Stripe Setup Intent Error");
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to create setup intent",
      data: null,
    });
  }
};

// Stripe Webhook Handler — verifies with tenant webhook secret from event metadata when present
export const handleWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = await constructStripeWebhookEvent(req.body, sig);
  } catch (err) {
    logger.warn({ errMessage: err.message }, "Webhook signature verification failed");
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const { tenantDb, organisationId } = await resolveTenantDbFromStripeObject(event.data?.object || {});

  // Idempotency: Duplicate Check
  const existingEvent = await platformDb.StripeWebhookEvent.findOne({ where: { event_id: event.id } });
  if (existingEvent) {
    return res.json({ received: true, duplicate: true });
  }

  const webhookEventRecord = await platformDb.StripeWebhookEvent.create({
    event_id: event.id,
    event_type: event.type,
    stripe_account_id: event.account || null,
    tenant_id: organisationId || null,
    processing_status: 'pending',
  });

  try {
    await processStripeWebhookEvent(event, tenantDb, req);
    
    webhookEventRecord.processing_status = 'processed';
    webhookEventRecord.processed_at = new Date();
    await webhookEventRecord.save();
    
    return res.json({ received: true });
  } catch (processErr) {
    logger.error({ err: processErr, eventId: event.id }, "Webhook processing failed, pushing to retry queue");
    
    webhookEventRecord.processing_status = 'failed';
    webhookEventRecord.error_message = processErr.message;
    await webhookEventRecord.save();

    await platformDb.PaymentWebhookRetryQueue.create({
      event_id: event.id,
      payload: event,
      error_reason: processErr.message,
      next_retry_at: new Date(Date.now() + 5 * 60 * 1000), // Retry in 5 minutes
    });

    // Return 200 to Stripe so it doesn't immediately backoff. We handle retries internally.
    return res.json({ received: true, queued_for_retry: true });
  }
};

const processStripeWebhookEvent = async (event, tenantDb, req) => {
  switch (event.type) {
    // Payment Events
    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object;
      logger.info({ paymentIntentId: paymentIntent.id }, "PaymentIntent was successful");
      if (paymentIntent.metadata?.userId) {
        const userId = Number(paymentIntent.metadata.userId);
        const result = await finalizeStripePaymentForUser({
          userId,
          paymentIntent,
          caseRef: paymentIntent.metadata.caseId,
        });

        if (result?.caseRecord && tenantDb) {
          await tenantDb.CaseTimeline.create({
            caseId: result.caseRecord.id,
            action: 'PAYMENT_RECEIVED',
            message: `Payment of £${paymentIntent.amount / 100} received successfully`,
            performedBy: userId,
          });
          await tenantDb.AuditLog.create({
            user_id: userId,
            action: 'PAYMENT_SUCCEEDED',
            details: `Payment intent ${paymentIntent.id} succeeded for £${paymentIntent.amount / 100} ${paymentIntent.currency.toUpperCase()}`,
            ip_address: req.ip || req.connection?.remoteAddress,
            status: 'Success'
          });
        }
      }
      break;
    }

    case "checkout.session.completed": {
      const session = event.data.object;

      // Org-admin subscription renewal (platform account). Backup path —
      // verify-session is authoritative; activation is idempotent on session id.
      if (
        session.metadata?.type === "org_subscription" &&
        session.payment_status === "paid"
      ) {
        const orgId = Number(session.metadata.subOrganisationId);
        if (orgId) {
          await activateOrgSubscriptionAfterPayment({
            organisationId: orgId,
            paymentRef: session.id,
            amount:
              session.amount_total != null ? session.amount_total / 100 : undefined,
            currency: session.currency,
            paymentIntentId:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.payment_intent?.id || null,
          }).catch((e) =>
            logger.error({ err: e }, "Org subscription webhook activation failed"),
          );
        }
        break;
      }

      if (session.payment_status === "paid" && session.metadata?.userId) {
        const userId = Number(session.metadata.userId);
        const ctx = tenantDb
          ? { stripe: (await getStripeForTenant(tenantDb)).stripe }
          : null;
        const paymentIntentId = session.payment_intent;
        if (paymentIntentId && ctx?.stripe) {
          const paymentIntent = await ctx.stripe.paymentIntents.retrieve(paymentIntentId);
          await finalizeStripePaymentForUser({
            userId,
            paymentIntent,
            caseRef: session.metadata.caseId,
          });
        }
      }
      break;
    }

    case "payment_intent.payment_failed": {
      const failedPayment = event.data.object;
      if (tenantDb && failedPayment.metadata?.userId) {
        const userId = Number(failedPayment.metadata.userId);
        const failReason = failedPayment.last_payment_error?.message || "Insufficient funds or declined";
        
        await notifyCandidatePaymentEvent(tenantDb, userId, {
          title: "Payment failed",
          message: failReason,
        });

        const caseIdNumeric = failedPayment.metadata.numericCaseId ? parseInt(failedPayment.metadata.numericCaseId, 10) : null;
        if (caseIdNumeric) {
          await tenantDb.CaseTimeline.create({
            caseId: caseIdNumeric,
            action: 'PAYMENT_FAILED',
            message: `Payment failed due to: ${failReason}`,
            performedBy: userId,
          });
        }

        await tenantDb.AuditLog.create({
          user_id: userId,
          action: 'PAYMENT_FAILED',
          details: `Payment intent ${failedPayment.id} failed: ${failReason}`,
          ip_address: req.ip || req.connection?.remoteAddress,
          status: 'Failed'
        });
      }
      break;
    }

    case "payment_intent.canceled": {
      const canceledPayment = event.data.object;
      if (tenantDb && canceledPayment.metadata?.userId) {
        await notifyCandidatePaymentEvent(
          tenantDb,
          Number(canceledPayment.metadata.userId),
          {
            title: "Payment canceled",
            message: "A pending payment was canceled before completion.",
            type: NotificationTypes.INFO,
          },
        );
      }
      break;
    }

    case "charge.refunded": {
      const charge = event.data.object;
      if (tenantDb && charge.metadata?.userId) {
        const userId = Number(charge.metadata.userId);
        const refundAmount = charge.amount_refunded / 100;
        
        await notifyCandidatePaymentEvent(tenantDb, userId, {
          title: "Refund Issued",
          message: `A refund of £${refundAmount} has been issued to your original payment method.`,
          type: NotificationTypes.SUCCESS,
        });

        const caseIdNumeric = charge.metadata.numericCaseId ? parseInt(charge.metadata.numericCaseId, 10) : null;
        if (caseIdNumeric) {
          const caseRecord = await tenantDb.Case.findByPk(caseIdNumeric);
          if (caseRecord) {
            const newPaid = Math.max(0, (Number(caseRecord.paidAmount) || 0) - refundAmount);
            await caseRecord.update({ paidAmount: newPaid, amountStatus: newPaid < Number(caseRecord.totalAmount) ? 'Pending' : caseRecord.amountStatus });
            
            await tenantDb.CaseTimeline.create({
              caseId: caseIdNumeric,
              action: 'PAYMENT_REFUNDED',
              message: `Refund issued for £${refundAmount}`,
              performedBy: userId,
            });
          }
        }

        await tenantDb.AuditLog.create({
          user_id: userId,
          action: 'PAYMENT_REFUNDED',
          details: `Refund of £${refundAmount} processed for charge ${charge.id}`,
          ip_address: req.ip || req.connection?.remoteAddress,
          status: 'Success'
        });
      }
      break;
    }

    case "invoice.payment_succeeded": {
      const successInvoice = event.data.object;
      if (tenantDb && successInvoice.subscription) {
        const { stripe } = await getStripeForTenant(tenantDb);
        const sub = await stripe.subscriptions.retrieve(successInvoice.subscription);
        await syncSubscriptionToCandidate(tenantDb, sub);
      }
      break;
    }

    case "invoice.payment_failed": {
      const failedInvoice = event.data.object;
      if (tenantDb) {
        const userId = Number(failedInvoice.metadata?.userId);
        if (userId) {
          await notifyCandidatePaymentEvent(tenantDb, userId, {
            title: "Subscription payment failed",
            message:
              "We could not process your subscription payment. Please update your payment method in the portal.",
          });
        }
      }
      break;
    }

    case "invoice.upcoming": {
      const upcomingInvoice = event.data.object;
      if (tenantDb) {
        const userId = Number(upcomingInvoice.metadata?.userId);
        if (userId) {
          await notifyCandidatePaymentEvent(tenantDb, userId, {
            title: "Upcoming payment",
            message: "A subscription payment is due soon. No action is needed if your card is up to date.",
            type: NotificationTypes.INFO,
          });
        }
      }
      break;
    }

    case "customer.created":
    case "customer.updated": {
      const customer = event.data.object;
      logger.info({ customerId: customer.id, email: customer.email }, "Customer created or updated");
      if (tenantDb && customer.metadata?.userId) {
        const userId = Number(customer.metadata.userId);
        await tenantDb.AuditLog.create({
          user_id: userId,
          action: event.type === 'customer.created' ? 'CUSTOMER_CREATED' : 'CUSTOMER_UPDATED',
          details: `Stripe customer profile ${customer.id} synced`,
          ip_address: req.ip || req.connection?.remoteAddress,
          status: 'Success'
        });
      }
      break;
    }

    case "customer.deleted": {
      const deletedCustomer = event.data.object;
      logger.info({ customerId: deletedCustomer.id }, "Customer deleted");
      if (tenantDb && deletedCustomer.metadata?.userId) {
        const userId = Number(deletedCustomer.metadata.userId);
        await tenantDb.AuditLog.create({
          user_id: userId,
          action: 'CUSTOMER_DELETED',
          details: `Stripe customer profile ${deletedCustomer.id} deleted`,
          ip_address: req.ip || req.connection?.remoteAddress,
          status: 'Success'
        });
      }
      break;
    }

    // Setup Intent Events
    case "setup_intent.created":
      break;

    case "setup_intent.succeeded": {
      const succeededSetup = event.data.object;
      if (tenantDb && succeededSetup.metadata?.userId) {
        const userId = Number(succeededSetup.metadata.userId);
        await notifyCandidatePaymentEvent(tenantDb, userId, {
          title: "Payment method saved",
          message: "Your new payment method has been verified and saved successfully.",
          type: NotificationTypes.SUCCESS,
        });

        const caseIdNumeric = succeededSetup.metadata.numericCaseId ? parseInt(succeededSetup.metadata.numericCaseId, 10) : null;
        if (caseIdNumeric) {
          await tenantDb.CaseTimeline.create({
            caseId: caseIdNumeric,
            action: 'PAYMENT_METHOD_SETUP',
            message: `Payment method setup successful`,
            performedBy: userId,
          });
        }

        await tenantDb.AuditLog.create({
          user_id: userId,
          action: 'SETUP_INTENT_SUCCEEDED',
          details: `Setup intent ${succeededSetup.id} succeeded`,
          ip_address: req.ip || req.connection?.remoteAddress,
          status: 'Success'
        });
      }
      break;
    }

    case "setup_intent.failed": {
      const failedSetup = event.data.object;
      if (tenantDb && failedSetup.metadata?.userId) {
        const userId = Number(failedSetup.metadata.userId);
        await notifyCandidatePaymentEvent(tenantDb, userId, {
          title: "Payment method failed",
          message: failedSetup.last_setup_error?.message || "We could not verify your payment method.",
        });

        await tenantDb.AuditLog.create({
          user_id: userId,
          action: 'SETUP_INTENT_FAILED',
          details: `Setup intent ${failedSetup.id} failed: ${failedSetup.last_setup_error?.message}`,
          ip_address: req.ip || req.connection?.remoteAddress,
          status: 'Failed'
        });
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object;
      if (tenantDb) {
        await syncSubscriptionToCandidate(tenantDb, subscription);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const deletedSubscription = event.data.object;
      if (tenantDb) {
        await syncSubscriptionToCandidate(tenantDb, {
          ...deletedSubscription,
          status: "canceled",
        });
        const userId = Number(deletedSubscription.metadata?.userId);
        if (userId) {
          await notifyCandidatePaymentEvent(tenantDb, userId, {
            title: "Subscription ended",
            message: "Your subscription has been canceled.",
            type: NotificationTypes.INFO,
          });
        }
      }
      break;
    }

    case "customer.subscription.trial_will_end": {
      const trialEnding = event.data.object;
      if (tenantDb) {
        const userId = Number(trialEnding.metadata?.userId);
        if (userId) {
          await notifyCandidatePaymentEvent(tenantDb, userId, {
            title: "Trial ending soon",
            message: "Your trial period is ending shortly. Please ensure your payment method is ready.",
            type: NotificationTypes.INFO,
          });
        }
      }
      break;
    }

    default:
      logger.info({ eventType: event.type }, "Unhandled event type");
  }
};

// Refund Payment
export const createRefund = async (req, res) => {
  try {
    const { stripe } = await getStripeForRequest(req);
    const { payment_intent_id, amount, reason } = req.validated.body;

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
    logger.error({ err: error }, "Stripe Refund Error");
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
    const { stripe } = await getStripeForRequest(req);
    const {
      customer_id,
      price_id,
      payment_method_id,
      metadata = {},
    } = req.validated.body;

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
      metadata: buildStripeMetadata(req, {
        userId: req.user?.userId ? String(req.user.userId) : "",
        ...metadata,
      }),
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
    logger.error({ err: error }, "Stripe Subscription Creation Error");
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
    const { stripe } = await getStripeForRequest(req);
    const { subscription_id, payment_method_id } = req.validated.body;

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
    logger.error({ err: error }, "Stripe Subscription Renewal Error");
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
    const { stripe } = await getStripeForRequest(req);
    const { subscription_id, cancel_at_period_end = true } = req.validated.body;

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
    logger.error({ err: error }, "Stripe Subscription Cancellation Error");
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
    const { stripe } = await getStripeForRequest(req);
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
    logger.error({ err: error }, "Stripe Subscription Status Error");
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
    const { stripe } = await getStripeForRequest(req);
    const { subscription_id, price_id, quantity = 1, metadata = {} } = req.validated.body;

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
    logger.error({ err: error }, "Stripe Subscription Update Error");
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to update subscription",
      data: null,
    });
  }
};

export const exportInvoiceReceiptPdf = catchAsync(async (req, res) => {
  const {
    caseId,
    amount,
    date,
    description = "Visa Application Fees",
    candidateName = "Client",
    isReceipt = true,
    platformName = "EPiC Immigration Services",
  } = req.validated.body || {};

  if (!caseId || amount === undefined || amount === null || !date) {
    return ApiResponse.badRequest(res, "caseId, amount, and date are required");
  }

  const amountNum = Number(amount);
  const totalAmountStr = `£${Number.isFinite(amountNum) ? amountNum.toFixed(2) : "0.00"}`;
  const safeCaseId = String(caseId).replace(/[^A-Za-z0-9_-]/g, "_");
  const invoiceNo = `INV-${safeCaseId}-${Date.now()}`;

  const logoPath = path.join(process.cwd(), "assets", "elitepic_logo.png");

  const sections = [
    {
      sectionTitle: isReceipt ? "Payment Receipt" : "Invoice",
      rows: [
        { label: "Description", value: description || "—" },
        { label: "Qty", value: "1" },
        { label: "Unit Price", value: totalAmountStr },
        { label: "Total", value: totalAmountStr },
        { label: "Billed To", value: candidateName || "Client" },
        { label: "Case Reference", value: String(caseId) },
        { label: "Receipt/Invoice No", value: invoiceNo },
        { label: "Date", value: String(date) },
      ],
    },
  ];

  const buffer = await generateBrandedPdfBuffer({
    logoPath,
    title: isReceipt ? "PAYMENT RECEIPT" : "INVOICE",
    sections,
    metadata: {
      subtitle: platformName || "EPiC Immigration Services",
      reference: `Receipt/Invoice No: ${invoiceNo}`,
      candidateName: candidateName || "Client",
    },
  });

  const filename = `${isReceipt ? "Receipt" : "Invoice"}_${safeCaseId}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(buffer);
});
