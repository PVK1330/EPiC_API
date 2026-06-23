import { Op } from 'sequelize';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import logger from '../../../utils/logger.js';
import { localDateStr } from '../../../utils/dateHelpers.js';
import { mergeCaseWhere } from '../../../utils/tenantScope.js';
import { getStripeForRequest, buildStripeMetadata } from '../../../services/stripeTenant.service.js';
import { generatePdfBufferFromDefinition } from '../../../services/pdfGenerator.service.js';
import { getSettingsByNamespace } from '../../../services/settings.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Invoice helpers ──────────────────────────────────────────────────────────

function _fmtGbp(amount) {
  const n = parseFloat(amount || 0);
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function _ukDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function _buildSponsorInvoiceDocDef({ invoiceNo, invoiceDate, status, amountNet, description, candidateName, platformName, supportEmail, sponsorProfile, logoDataUri }) {
  const statusColour = status === 'completed' ? '#16a34a' : status === 'failed' ? '#dc2626' : '#d97706';

  const images = {};
  if (logoDataUri) images.supplierLogo = logoDataUri;

  const billToName = sponsorProfile?.companyName || sponsorProfile?.tradingName || 'Sponsor Organisation';
  const billToEmail = sponsorProfile?.billingEmail || sponsorProfile?.authorisingEmail || '—';
  const billToAddress = [sponsorProfile?.registeredAddress, sponsorProfile?.city, sponsorProfile?.postalCode, sponsorProfile?.country || 'United Kingdom']
    .filter(Boolean).join(', ') || 'United Kingdom';

  const content = [];

  // Header: logo left, INVOICE right
  content.push({
    columns: [
      logoDataUri
        ? { image: 'supplierLogo', width: 120, alignment: 'left' }
        : { text: platformName, style: 'supplierName' },
      {
        stack: [
          { text: 'INVOICE', style: 'invoiceTitle', alignment: 'right' },
          { text: invoiceNo, style: 'invoiceNumber', alignment: 'right' },
        ],
        width: '*',
      },
    ],
    margin: [0, 0, 0, 16],
  });

  // Blue divider
  content.push({
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 495, y2: 0, lineWidth: 1.5, lineColor: '#1d4ed8' }],
    margin: [0, 0, 0, 14],
  });

  // 3-column: FROM / BILL TO / INVOICE DETAILS
  content.push({
    columns: [
      {
        stack: [
          { text: 'FROM', style: 'blockLabel' },
          { text: platformName, style: 'blockCompany' },
          { text: 'Elite PiC Ltd', style: 'blockDetail' },
          { text: 'United Kingdom', style: 'blockDetail' },
          { text: supportEmail, style: 'blockDetail' },
        ],
        width: 165,
      },
      {
        stack: [
          { text: 'BILL TO', style: 'blockLabel' },
          { text: billToName, style: 'blockCompany' },
          { text: billToEmail, style: 'blockDetail' },
          { text: billToAddress, style: 'blockDetail' },
        ],
        width: 165,
      },
      {
        stack: [
          { text: 'INVOICE DETAILS', style: 'blockLabel' },
          {
            table: {
              widths: ['auto', '*'],
              body: [
                [{ text: 'Invoice No:', style: 'metaKey' }, { text: invoiceNo, style: 'metaVal' }],
                [{ text: 'Date:', style: 'metaKey' }, { text: _ukDate(invoiceDate), style: 'metaVal' }],
                [{ text: 'Status:', style: 'metaKey' }, { text: (status || 'pending').toUpperCase(), style: 'metaVal', color: statusColour, bold: true }],
                [{ text: 'Currency:', style: 'metaKey' }, { text: 'GBP', style: 'metaVal' }],
              ],
            },
            layout: 'noBorders',
          },
        ],
        width: 165,
      },
    ],
    columnGap: 0,
    margin: [0, 0, 0, 20],
  });

  // Line items table
  const descStack = [{ text: description, style: 'itemDesc' }];
  if (candidateName) descStack.push({ text: `Worker: ${candidateName}`, style: 'itemSubDesc' });

  content.push({
    table: {
      headerRows: 1,
      widths: ['*', 85],
      body: [
        [
          { text: 'Description', style: 'tableHeader' },
          { text: 'Amount', style: 'tableHeader', alignment: 'right' },
        ],
        [
          { stack: descStack },
          { text: _fmtGbp(amountNet), style: 'itemCell', alignment: 'right', bold: true },
        ],
      ],
    },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length) ? 1 : 0.5,
      vLineWidth: () => 0,
      hLineColor: (i) => i <= 1 ? '#1d4ed8' : '#e2e8f0',
      fillColor: (row) => row === 0 ? '#1d4ed8' : (row % 2 === 0 ? '#f8fafc' : null),
      paddingLeft: () => 8,
      paddingRight: () => 8,
      paddingTop: () => 7,
      paddingBottom: () => 7,
    },
    margin: [0, 0, 0, 14],
  });

  // Totals block
  content.push({
    columns: [
      { text: '', width: '*' },
      {
        table: {
          widths: [140, 80],
          body: [
            [{ text: 'AMOUNT DUE', style: 'totalsFinalLabel' }, { text: _fmtGbp(amountNet), style: 'totalsFinalVal' }],
          ],
        },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: () => 0,
          fillColor: () => '#1d4ed8',
          paddingLeft: () => 8,
          paddingRight: () => 8,
          paddingTop: () => 8,
          paddingBottom: () => 8,
        },
        width: 'auto',
      },
    ],
    margin: [0, 0, 0, 20],
  });

  // Payment note
  if (status === 'completed') {
    content.push({
      stack: [
        { text: 'Payment Received — Thank You', style: 'notesTitle', color: '#16a34a' },
        { text: `Settled on ${_ukDate(invoiceDate)}.`, style: 'notesBody' },
      ],
      margin: [0, 0, 0, 14],
    });
  } else {
    content.push({
      stack: [
        { text: 'Payment Instructions', style: 'notesTitle' },
        { text: 'Please quote the invoice number as the payment reference. Payment is due upon receipt. Late payment may result in service suspension.', style: 'notesBody' },
      ],
      margin: [0, 0, 0, 14],
    });
  }

  // Footer rule
  content.push({
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 495, y2: 0, lineWidth: 0.5, lineColor: '#cbd5e1' }],
    margin: [0, 0, 0, 6],
  });
  content.push({
    text: `${platformName} · ${supportEmail} · Computer-generated invoice. No signature required.`,
    style: 'footerNote',
    alignment: 'center',
  });

  return {
    pageSize: 'A4',
    pageMargins: [52, 52, 52, 60],
    content,
    images,
    footer: (currentPage, pageCount) => ({
      margin: [52, 8, 52, 0],
      columns: [
        { text: `${platformName} — Confidential`, style: 'footerText', width: '*' },
        { text: `Page ${currentPage} of ${pageCount}`, style: 'footerText', alignment: 'right', width: 'auto' },
      ],
    }),
    styles: {
      invoiceTitle:     { fontSize: 22, bold: true, color: '#1e293b' },
      invoiceNumber:    { fontSize: 9, color: '#64748b', margin: [0, 3, 0, 0] },
      supplierName:     { fontSize: 15, bold: true, color: '#1e293b' },
      blockLabel:       { fontSize: 7, bold: true, color: '#94a3b8', margin: [0, 0, 0, 3] },
      blockCompany:     { fontSize: 10, bold: true, color: '#1e293b', margin: [0, 0, 0, 1] },
      blockDetail:      { fontSize: 8, color: '#475569', margin: [0, 1, 0, 0] },
      metaKey:          { fontSize: 8, color: '#64748b', margin: [0, 1, 4, 1] },
      metaVal:          { fontSize: 8, bold: true, color: '#1e293b', margin: [0, 1, 0, 1] },
      tableHeader:      { fontSize: 8, bold: true, color: '#ffffff' },
      itemDesc:         { fontSize: 9, bold: true, color: '#1e293b' },
      itemSubDesc:      { fontSize: 7, color: '#64748b', margin: [0, 1, 0, 0] },
      itemCell:         { fontSize: 9, color: '#1e293b' },
      totalsFinalLabel: { fontSize: 10, bold: true, color: '#ffffff' },
      totalsFinalVal:   { fontSize: 10, bold: true, color: '#ffffff', alignment: 'right' },
      notesTitle:       { fontSize: 8, bold: true, color: '#334155', margin: [0, 0, 0, 3] },
      notesBody:        { fontSize: 7.5, color: '#64748b', lineHeight: 1.4 },
      footerNote:       { fontSize: 7, color: '#94a3b8' },
      footerText:       { fontSize: 7, color: '#94a3b8' },
    },
    defaultStyle: { font: 'Helvetica', fontSize: 9, color: '#1e293b' },
  };
}

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

/**
 * Generate and stream a UK-compliant invoice PDF for a sponsor payment.
 * GET /api/business/payments/:id/invoice?kind=case|sponsor
 */
export const downloadSponsorInvoice = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorised' });

    const paymentId = parseInt(req.params.id, 10);
    const kind = req.query.kind || 'case';

    if (!Number.isFinite(paymentId) || paymentId <= 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid payment ID' });
    }

    let paymentRecord;
    if (kind === 'sponsor') {
      paymentRecord = await req.tenantDb.SponsorPayment.findOne({
        where: { id: paymentId, sponsorUserId: userId },
      });
    } else {
      paymentRecord = await req.tenantDb.CasePayment.findOne({
        where: { id: paymentId },
        include: [
          {
            model: req.tenantDb.Case,
            attributes: ['caseId', 'sponsorId'],
            include: [{ model: req.tenantDb.User, as: 'candidate', attributes: ['first_name', 'last_name'] }],
          },
        ],
      });
      if (paymentRecord && Number(paymentRecord.Case?.sponsorId) !== userId) {
        paymentRecord = null;
      }
    }

    if (!paymentRecord) {
      return res.status(404).json({ status: 'error', message: 'Payment not found' });
    }

    const sponsorProfile = await req.tenantDb.SponsorProfile.findOne({ where: { userId } });

    let platformSettings = {};
    try {
      platformSettings = (await getSettingsByNamespace('platform')) || {};
    } catch {
      // fallback to defaults
    }
    const platformName = platformSettings['platform_name'] || 'EPiC HRIS Platform';
    const supportEmail = platformSettings['support_email'] || 'support@elitepic.co.uk';

    const logoPath = path.join(__dirname, '../../../../assets/elitepic_logo.png');
    let logoDataUri = null;
    if (fs.existsSync(logoPath)) {
      const buf = fs.readFileSync(logoPath);
      logoDataUri = `data:image/png;base64,${buf.toString('base64')}`;
    }

    const amountNet = Number(paymentRecord.amount || 0);
    const invoiceNo = kind === 'sponsor'
      ? (paymentRecord.stripe_payment_intent_id || paymentRecord.stripePaymentIntentId || `SP-${paymentRecord.id}`)
      : (paymentRecord.invoiceNumber || `INV-${paymentRecord.id}`);
    const invoiceDate = kind === 'sponsor'
      ? (paymentRecord.paid_at || paymentRecord.paidAt || paymentRecord.created_at)
      : (paymentRecord.paymentDate || paymentRecord.created_at);
    const status = kind === 'sponsor' ? paymentRecord.status : paymentRecord.paymentStatus;
    const description = kind === 'sponsor'
      ? (paymentRecord.description || 'Sponsor Payment')
      : (paymentRecord.notes || (paymentRecord.Case?.caseId ? `Case fee — ${paymentRecord.Case.caseId}` : 'Case Payment'));
    const candidateName = kind === 'case'
      ? `${paymentRecord.Case?.candidate?.first_name || ''} ${paymentRecord.Case?.candidate?.last_name || ''}`.trim() || null
      : null;

    const docDef = _buildSponsorInvoiceDocDef({
      invoiceNo,
      invoiceDate,
      status,
      amountNet,
      description,
      candidateName,
      platformName,
      supportEmail,
      sponsorProfile,
      logoDataUri,
    });

    const buffer = await generatePdfBufferFromDefinition(docDef);
    const safeNo = invoiceNo.replace(/[^\w\-]/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Invoice_${safeNo}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    return res.end(buffer);
  } catch (err) {
    logger.error({ err }, 'downloadSponsorInvoice error');
    if (!res.headersSent) {
      res.status(500).json({ status: 'error', message: 'Failed to generate invoice' });
    }
  }
};
