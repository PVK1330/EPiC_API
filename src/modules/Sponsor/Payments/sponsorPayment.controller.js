import { Op } from 'sequelize';
import logger from '../../../utils/logger.js';
import { localDateStr } from '../../../utils/dateHelpers.js';
import { mergeCaseWhere } from '../../../utils/tenantScope.js';
import { getStripeForRequest, buildStripeMetadata } from '../../../services/stripeTenant.service.js';

/**
 * Sponsor (business) online payments — Stripe Checkout on the TENANT's own
 * Stripe account (the keys the org admin enters in Admin → Payment Config,
 * resolved via getStripeForRequest because every sponsor route runs
 * attachTenantDb, so req.tenantDb is always set).
 *
 * Mirrors the candidate flow exactly: server-computed amount, redirect Checkout
 * (so no publishable key on the client and NO webhook secret needed), and an
 * authoritative post-redirect verify-session that records the payment.
 *
 * Ledgers, one home per fee type:
 *   - case_fee   → case_payments (+ Case.paidAmount), the single source of truth
 *                  for case balances shared with the candidate flow.
 *   - licence_fee / isc → sponsor_payments (their only home; case_payments needs
 *                  a caseId these fees do not have).
 */

const uid = (req) => {
  const n = Number(req.user?.userId);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};

const PAYABLE_TYPES = new Set(['licence_fee', 'isc', 'case_fee']);
const MIN_AMOUNT = 0.5;

/**
 * Compute the sponsor's OUTSTANDING payables from authoritative sources. Used by
 * both the checkout endpoint (to validate + price a single payable) and the
 * payments list (to render Pay Now rows). Amounts are always server-derived.
 */
export async function computeSponsorPayables(req) {
  const tenantDb = req.tenantDb;
  const userId = uid(req);
  if (!userId) return [];

  const payables = [];

  // ── Licence fee + Immigration Skills Charge (from licence applications) ──────
  const apps = await tenantDb.LicenceApplication.findAll({
    where: { userId, status: { [Op.ne]: 'Draft' } },
    attributes: ['id', 'companyName', 'status', 'feeBase', 'feeTotal', 'feeIscEstimate', 'feeCurrency'],
  });

  const appRefs = apps.map((a) => String(a.id));
  const completed = appRefs.length
    ? await tenantDb.SponsorPayment.findAll({
        where: {
          sponsorUserId: userId,
          status: 'completed',
          payableType: { [Op.in]: ['licence_fee', 'isc'] },
          payableRef: { [Op.in]: appRefs },
        },
        attributes: ['payableType', 'payableRef'],
      })
    : [];
  const paidSet = new Set(completed.map((c) => `${c.payableType}:${c.payableRef}`));

  for (const app of apps) {
    const currency = (app.feeCurrency || 'GBP').toUpperCase();
    const licenceAmount = Number(app.feeTotal) || 0;
    const label = app.companyName || `application #${app.id}`;

    if (licenceAmount >= MIN_AMOUNT && !paidSet.has(`licence_fee:${app.id}`)) {
      payables.push({
        payableType: 'licence_fee',
        payableRef: String(app.id),
        description: `Sponsor licence fee — ${label}`,
        amount: licenceAmount,
        currency,
      });
    }

    const iscAmount = Number(app.feeIscEstimate) || 0;
    if (iscAmount >= MIN_AMOUNT && !paidSet.has(`isc:${app.id}`)) {
      payables.push({
        payableType: 'isc',
        payableRef: String(app.id),
        description: `Immigration Skills Charge (estimate) — ${label}`,
        amount: iscAmount,
        currency,
      });
    }
  }

  // ── Outstanding case-fee balances (sponsor's sponsored-worker cases) ─────────
  const cases = await tenantDb.Case.findAll({
    where: mergeCaseWhere(req, { sponsorId: userId }),
    attributes: ['id', 'caseId', 'totalAmount', 'paidAmount'],
  });
  for (const c of cases) {
    const total = Number(c.totalAmount) || 0;
    const paid = Number(c.paidAmount) || 0;
    const balance = Math.max(0, total - paid);
    if (total > 0 && balance >= MIN_AMOUNT) {
      payables.push({
        payableType: 'case_fee',
        payableRef: String(c.id),
        description: `Case fees — ${c.caseId || c.id}`,
        amount: balance,
        currency: 'GBP',
      });
    }
  }

  return payables;
}

/** Resolve a single payable to a server-authoritative amount + context. */
async function resolveSponsorPayable({ tenantDb, userId, payableType, payableRef }) {
  if (!PAYABLE_TYPES.has(payableType)) {
    return { ok: false, status: 400, message: 'Unknown payable type' };
  }

  if (payableType === 'case_fee') {
    const caseRecord = await tenantDb.Case.findOne({
      where: { id: Number(payableRef), sponsorId: userId },
    });
    if (!caseRecord) return { ok: false, status: 404, message: 'Case not found for your account' };
    const total = Number(caseRecord.totalAmount) || 0;
    const paid = Number(caseRecord.paidAmount) || 0;
    const balance = Math.max(0, total - paid);
    return {
      ok: true,
      amount: balance,
      currency: 'gbp',
      description: `Case fees — ${caseRecord.caseId || caseRecord.id}`,
      caseRecord,
    };
  }

  // licence_fee | isc
  const app = await tenantDb.LicenceApplication.findOne({
    where: { id: Number(payableRef), userId },
  });
  if (!app) return { ok: false, status: 404, message: 'Licence application not found for your account' };

  const alreadyPaid = await tenantDb.SponsorPayment.findOne({
    where: { sponsorUserId: userId, status: 'completed', payableType, payableRef: String(app.id) },
  });
  if (alreadyPaid) {
    return {
      ok: false,
      status: 409,
      message: payableType === 'isc' ? 'Immigration Skills Charge already paid' : 'Licence fee already paid',
    };
  }

  const amount = payableType === 'isc' ? Number(app.feeIscEstimate) || 0 : Number(app.feeTotal) || 0;
  const currency = (app.feeCurrency || 'GBP').toLowerCase();
  const label = app.companyName || `application #${app.id}`;
  const description =
    payableType === 'isc'
      ? `Immigration Skills Charge (estimate) — ${label}`
      : `Sponsor licence fee — ${label}`;
  return { ok: true, amount, currency, description, application: app };
}

function frontendBase() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')[0]
    .trim()
    .replace(/\/$/, '');
}

/**
 * Record a sponsor case-fee payment into case_payments and update the case
 * balance. Idempotent: a row-locked transaction keyed on the Stripe payment
 * intent id, so the webhook and verify-session cannot double-credit the case.
 */
async function recordSponsorCaseFeePayment({ tenantDb, caseRecord, paymentIntent, sponsorUserId }) {
  const txnId = paymentIntent?.id;
  if (!txnId) return null;

  const amount = paymentIntent.amount / 100;
  const paymentStatus = paymentIntent.status === 'succeeded' ? 'completed' : 'pending';

  let created = false;
  let casePayment;
  try {
    casePayment = await tenantDb.sequelize.transaction(async (t) => {
      await caseRecord.reload({ transaction: t, lock: t.LOCK.UPDATE });
      const existing = await tenantDb.CasePayment.findOne({
        where: { transactionId: String(txnId), caseId: caseRecord.id },
        transaction: t,
      });
      if (existing) return existing;
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
          description: 'Sponsor online payment (case fee)',
          receivedBy: sponsorUserId || null,
        },
        { transaction: t },
      );
    });
  } catch (err) {
    if (err?.name === 'SequelizeUniqueConstraintError') {
      const existing = await tenantDb.CasePayment.findOne({
        where: { transactionId: String(txnId), caseId: caseRecord.id },
      });
      if (existing) {
        await caseRecord.reload();
        return existing;
      }
    }
    throw err;
  }

  if (!created) {
    await caseRecord.reload();
    return casePayment;
  }

  if (paymentStatus === 'completed') {
    const prevPaid = Number(caseRecord.paidAmount) || 0;
    const newPaid = prevPaid + amount;
    const total = Number(caseRecord.totalAmount) || 0;
    const updates = { paidAmount: newPaid };
    if (total > 0 && newPaid >= total - 0.02) updates.amountStatus = 'Paid';
    await caseRecord.update(updates);
    await caseRecord.reload();
  }

  return casePayment;
}

/** POST /api/business/payments/checkout — create a tenant Stripe Checkout session. */
export const createSponsorCheckoutSession = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });

    const { payableType, payableRef } = req.body || {};
    if (!payableType || payableRef == null) {
      return res.status(400).json({ status: 'error', message: 'payableType and payableRef are required', data: null });
    }

    // getStripeForRequest builds the tenant client eagerly and throws when no
    // secret key is configured — translate that into a clean 503 so the sponsor
    // sees an actionable message instead of a generic 500.
    let stripe;
    let settings;
    try {
      ({ stripe, settings } = await getStripeForRequest(req));
    } catch {
      settings = null;
    }
    if (!stripe || !settings?.stripe_secret_key) {
      return res.status(503).json({
        status: 'error',
        message: 'Stripe is not configured for this organisation. Ask your administrator to add keys in Admin → Payment Config.',
        data: null,
      });
    }

    const resolved = await resolveSponsorPayable({
      tenantDb: req.tenantDb,
      userId,
      payableType,
      payableRef,
    });
    if (!resolved.ok) {
      return res.status(resolved.status).json({ status: 'error', message: resolved.message, data: null });
    }
    if (!resolved.amount || resolved.amount < MIN_AMOUNT) {
      return res.status(400).json({
        status: 'error',
        message: 'No outstanding balance, or amount is below the minimum (£0.50).',
        data: null,
      });
    }

    const currency = (resolved.currency || 'gbp').toLowerCase();
    const base = frontendBase();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency,
            product_data: { name: resolved.description },
            unit_amount: Math.round(resolved.amount * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${base}/business/payment?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/business/payment?payment=cancelled`,
      metadata: buildStripeMetadata(req, {
        kind: 'sponsor_payment',
        payableType,
        payableRef: String(payableRef),
        sponsorUserId: String(userId),
      }),
    });

    // licence_fee / isc have no case_payments home — record a pending ledger row
    // keyed on the session id for idempotent finalisation. case_fee is recorded
    // into case_payments at verify time (matching the candidate flow).
    if (payableType !== 'case_fee') {
      await req.tenantDb.SponsorPayment.create({
        sponsorUserId: userId,
        organisationId: req.user?.organisation_id ?? null,
        payableType,
        payableRef: String(payableRef),
        description: resolved.description,
        amount: resolved.amount,
        currency: (resolved.currency || 'GBP').toUpperCase(),
        status: 'pending',
        stripeSessionId: session.id,
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Checkout session created',
      data: { url: session.url, session_id: session.id, amount: resolved.amount, currency },
    });
  } catch (error) {
    logger.error({ err: error }, 'createSponsorCheckoutSession');
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to create checkout session',
      data: null,
    });
  }
};

/** GET /api/business/payments/verify-session/:session_id — authoritative finalise. */
export const verifySponsorCheckoutSession = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });

    const { session_id } = req.params;
    if (!session_id) {
      return res.status(400).json({ status: 'error', message: 'session_id is required', data: null });
    }

    const { stripe } = await getStripeForRequest(req);
    const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ['payment_intent'] });

    if (
      session.metadata?.kind !== 'sponsor_payment' ||
      String(session.metadata?.sponsorUserId || '') !== String(userId)
    ) {
      return res.status(403).json({
        status: 'error',
        message: 'This payment session does not belong to your account',
        data: null,
      });
    }

    if (session.payment_status !== 'paid') {
      return res.status(200).json({
        status: 'success',
        message: 'Payment not completed yet',
        data: { paid: false, payment_status: session.payment_status },
      });
    }

    const paymentIntent =
      typeof session.payment_intent === 'object'
        ? session.payment_intent
        : await stripe.paymentIntents.retrieve(session.payment_intent);
    const paymentIntentId =
      typeof session.payment_intent === 'object' ? session.payment_intent?.id : session.payment_intent || null;

    const payableType = session.metadata.payableType;
    const payableRef = session.metadata.payableRef;

    if (payableType === 'case_fee') {
      const caseRecord = await req.tenantDb.Case.findOne({
        where: { id: Number(payableRef), sponsorId: userId },
      });
      if (caseRecord) {
        await recordSponsorCaseFeePayment({
          tenantDb: req.tenantDb,
          caseRecord,
          paymentIntent,
          sponsorUserId: userId,
        });
      }
    } else {
      // licence_fee | isc — finalise the ledger row idempotently on the session id.
      const row = await req.tenantDb.SponsorPayment.findOne({ where: { stripeSessionId: session.id } });
      if (row) {
        if (row.status !== 'completed') {
          await row.update({ status: 'completed', paidAt: new Date(), stripePaymentIntentId: paymentIntentId });
        }
      } else {
        // Defensive: the pending row went missing — record the completed payment.
        await req.tenantDb.SponsorPayment.create({
          sponsorUserId: userId,
          organisationId: req.user?.organisation_id ?? null,
          payableType,
          payableRef: String(payableRef),
          description: session.metadata.description || `Sponsor ${payableType}`,
          amount: session.amount_total != null ? session.amount_total / 100 : 0,
          currency: (session.currency || 'GBP').toUpperCase(),
          status: 'completed',
          paidAt: new Date(),
          stripeSessionId: session.id,
          stripePaymentIntentId: paymentIntentId,
        });
      }
    }

    return res.status(200).json({
      status: 'success',
      message: 'Payment verified',
      data: { paid: true, payableType },
    });
  } catch (error) {
    logger.error({ err: error }, 'verifySponsorCheckoutSession');
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to verify checkout session',
      data: null,
    });
  }
};
