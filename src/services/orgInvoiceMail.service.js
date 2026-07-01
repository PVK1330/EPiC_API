/**
 * orgInvoiceMail.service.js
 * Emails an organisation its subscription invoice (with the invoice PDF attached)
 * after a successful platform-account payment.
 *
 * Reuses the same UK invoice PDF the superadmin download endpoint produces
 * (buildUkInvoiceDocDef) so the attached document is byte-identical to the one
 * shown in the platform — single source of truth for invoice formatting.
 *
 * Best-effort: never throws into the payment/activation path. A failed email
 * must NOT roll back a successful charge.
 */
import platformDb from "../models/index.js";
import logger from "../utils/logger.js";
import { sendTransactionalEmail } from "./mail.service.js";
import { generateNotificationEmailTemplate } from "../utils/emailTemplates.js";
import {
  getOrganisationEmailBranding,
  clearEmailBrandingCache,
} from "../utils/emailBranding.js";
import { getSettingsByNamespace } from "./settings.service.js";
import { buildUkInvoiceDocDef } from "../modules/Superadmin/invoice.controller.js";
import { generatePdfBufferFromDefinition } from "./pdfGenerator.service.js";

const CURRENCY_SYMBOLS = { GBP: "£", USD: "$", EUR: "€", CAD: "$", AUD: "$" };

function formatMoney(amount, currency = "GBP") {
  const sym = CURRENCY_SYMBOLS[String(currency).toUpperCase()] || "";
  const n = Number(amount);
  return `${sym}${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
}

/**
 * Load the invoice with everything the PDF + email need, build the invoice PDF,
 * and email it to the organisation's primary contact (and admin if provided).
 *
 * @param {Object} p
 * @param {number} p.invoiceId            The Invoice row id created at activation.
 * @param {string} [p.toOverride]         Optional explicit recipient (e.g. the paying admin).
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string }>}
 */
export async function sendOrgSubscriptionInvoiceEmail({ invoiceId, toOverride } = {}) {
  try {
    if (!invoiceId) return { ok: false, skipped: true, reason: "no_invoice_id" };

    const invoice = await platformDb.Invoice.findByPk(invoiceId, {
      include: [
        {
          model: platformDb.Organisation,
          as: "organisation",
          attributes: ["id", "name", "slug", "primaryEmail", "country", "logoUrl"],
        },
        {
          model: platformDb.Subscription,
          as: "subscription",
          include: [
            {
              model: platformDb.Plan,
              as: "plan",
              attributes: ["id", "name", "price", "billing_cycle"],
            },
          ],
        },
      ],
    });

    if (!invoice) {
      return { ok: false, skipped: true, reason: "invoice_not_found" };
    }

    const org = invoice.organisation;
    const recipient = (toOverride || org?.primaryEmail || "").trim();
    if (!recipient) {
      logger.warn(
        { invoiceId, organisationId: org?.id },
        "[orgInvoiceMail] No recipient email — skipping invoice email",
      );
      return { ok: false, skipped: true, reason: "no_recipient" };
    }

    // Build the invoice PDF (same document as the superadmin download endpoint).
    const platformSettings = await getSettingsByNamespace(null);
    const docDefinition = await buildUkInvoiceDocDef(invoice, platformSettings);
    const pdfBuffer = await generatePdfBufferFromDefinition(docDefinition);

    // Branded email body.
    clearEmailBrandingCache(org.id);
    const branding = await getOrganisationEmailBranding(org.id);

    const planName = invoice.subscription?.plan?.name || "your plan";
    const total = formatMoney(invoice.total ?? invoice.amount, invoice.currency);
    const safeNum = (invoice.invoice_number || `INV-${invoice.id}`).replace(
      /[^a-zA-Z0-9_-]/g,
      "_",
    );

    const html = generateNotificationEmailTemplate({
      branding,
      recipientName: org.name || "there",
      title: "Payment received — your subscription is active",
      notificationType: "success",
      priority: "medium",
      message: [
        `Thank you — we've received your payment of ${total} for the ${planName} subscription.`,
        `Your invoice ${invoice.invoice_number || ""} is attached to this email as a PDF for your records.`,
        `Your subscription is now active. You can sign in and continue using your workspace.`,
      ].join("\n\n"),
    });

    const result = await sendTransactionalEmail({
      organisationId: org.id,
      to: recipient,
      subject: `Your ${planName} invoice ${invoice.invoice_number || ""}`.trim(),
      html,
      brandingOverride: branding,
      attachments: [
        {
          filename: `Invoice_${safeNum}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
      failureContext: `org_subscription_invoice:${invoice.invoice_number || invoice.id}`,
    });

    logger.info(
      { invoiceId, organisationId: org.id, sent: result?.sent !== false },
      "[orgInvoiceMail] Subscription invoice email dispatched",
    );
    return { ok: true };
  } catch (err) {
    // Never let an email failure break the payment flow.
    logger.error({ err, invoiceId }, "[orgInvoiceMail] Failed to send invoice email");
    return { ok: false, reason: "exception" };
  }
}
