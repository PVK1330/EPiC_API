import { Op } from "sequelize";
import platformDb from "../../models/index.js";
import catchAsync from "../../utils/catchAsync.js";
import ApiResponse from "../../utils/apiResponse.js";
import { rowsToXlsxBuffer, sendXlsxDownload } from "../../utils/excelExport.util.js";
import { generatePdfBufferFromDefinition } from "../../services/pdfGenerator.service.js";
import { getSettingsByNamespace } from "../../services/settings.service.js";
import { getPaginationParams, buildPaginationMeta } from "../../utils/paginate.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── PDF helpers ──────────────────────────────────────────────────────────────

function resolveLogoDataUri(logoUrl) {
  if (!logoUrl) return null;
  try {
    const basename = path.basename(String(logoUrl).split("?")[0]);
    if (!basename) return null;
    const searchDirs = [
      path.join(__dirname, "../../../storage/private/organisations"),
      path.join(__dirname, "../../../storage/private/platform"),
      path.join(__dirname, "../../../storage/private/superadmin"),
      path.join(__dirname, "../../../storage/private/avatars"),
      path.join(__dirname, "../../../uploads"),
    ];
    for (const dir of searchDirs) {
      const candidate = path.join(dir, basename);
      if (fs.existsSync(candidate)) {
        const buf = fs.readFileSync(candidate);
        const ext = path.extname(basename).toLowerCase();
        const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
          : ext === ".gif" ? "image/gif" : "image/png";
        return `data:${mime};base64,${buf.toString("base64")}`;
      }
    }
  } catch { /* silent */ }
  return null;
}

function formatGbp(amount) {
  const n = parseFloat(amount || 0);
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ukDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function ukDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatLongString(str, maxLength = 25) {
  if (!str) return "";
  const s = String(str);
  if (s.length <= maxLength) return s;
  const keep = Math.floor((maxLength - 3) / 2);
  return s.slice(0, keep) + "..." + s.slice(-keep);
}

async function buildUkReceiptDocDef(txn, platformSettings) {
  const org = txn.organisation || {};
  const invoice = txn.invoice || {};

  const platformName = platformSettings["platform_name"] || "EPiC HRIS Platform";
  const supportEmail = platformSettings["support_email"] || "support@elitepic.co.uk";
  const platformLogoUrl = platformSettings["logo_url"] || null;

  // Taxation — prefer the linked invoice's persisted breakdown (txn.amount =
  // GROSS for itemised org-subscription charges); else fall back to the
  // configured rate for legacy rows where amount is the net subscription price.
  const hasBreakdown = invoice.total != null && invoice.tax_amount != null;
  const taxRateRaw = parseFloat((hasBreakdown ? invoice.tax_rate : platformSettings["tax_rate"]) || "0");
  const taxRate = Number.isFinite(taxRateRaw) && taxRateRaw > 0 ? taxRateRaw / 100 : 0;
  const taxId = platformSettings["tax_id"] || null;
  const taxEnabled = hasBreakdown ? parseFloat(invoice.tax_amount || 0) > 0 : taxRate > 0;

  // Resolve platform logo
  const platformLogoPath = path.join(__dirname, "../../assets/elitepic_logo.png");
  let logoDataUri = null;
  if (fs.existsSync(platformLogoPath)) {
    const buf = fs.readFileSync(platformLogoPath);
    logoDataUri = `data:image/png;base64,${buf.toString("base64")}`;
  } else {
    logoDataUri = resolveLogoDataUri(platformLogoUrl);
  }

  const orgLogoDataUri = resolveLogoDataUri(org.logoUrl);

  const amountNet = parseFloat((hasBreakdown ? invoice.subtotal : txn.amount) || 0);
  const taxAmount = hasBreakdown
    ? parseFloat(invoice.tax_amount || 0)
    : (taxEnabled ? parseFloat((amountNet * taxRate).toFixed(2)) : 0);
  const totalGross = hasBreakdown
    ? parseFloat((invoice.total ?? txn.amount) || 0)
    : parseFloat((amountNet + taxAmount).toFixed(2));

  const statusColour = txn.status === "completed" ? "#16a34a"
    : txn.status === "refunded" ? "#d97706"
    : txn.status === "failed" ? "#dc2626" : "#475569";

  const images = {};
  if (logoDataUri) images.supplierLogo = logoDataUri;
  if (orgLogoDataUri) images.clientLogo = orgLogoDataUri;

  const content = [];

  // ── Header: logo left, PAYMENT RECEIPT right ──
  content.push({
    columns: [
      logoDataUri
        ? { image: "supplierLogo", width: 120, alignment: "left" }
        : { text: platformName, style: "supplierName" },
      {
        stack: [
          { text: "PAYMENT RECEIPT", style: "receiptTitle", alignment: "right" },
          { text: formatLongString(txn.reference || `TXN-${txn.id}`, 24), style: "receiptRef", alignment: "right" },
        ],
        width: "*",
      },
    ],
    margin: [0, 0, 0, 16],
  });

  // ── Divider ──
  content.push({
    canvas: [{ type: "line", x1: 0, y1: 0, x2: 495, y2: 0, lineWidth: 1.5, lineColor: "#1d4ed8" }],
    margin: [0, 0, 0, 14],
  });

  // ── Supplier / Recipient side by side (two equal columns) ──
  const supplierBlock = [
    { text: "SUPPLIER", style: "blockLabel" },
    { text: platformName, style: "blockCompany" },
    { text: "Elite PiC Ltd", style: "blockDetail" },
    { text: "United Kingdom", style: "blockDetail" },
    { text: supportEmail, style: "blockDetail" },
    taxEnabled && taxId ? { text: `Tax No: ${taxId}`, style: "blockDetail" } : {},
  ];

  const recipientBlock = [
    { text: "RECIPIENT", style: "blockLabel" },
    { text: org.name || "—", style: "blockCompany" },
    { text: org.primaryEmail || "—", style: "blockDetail" },
    { text: org.country || "United Kingdom", style: "blockDetail" },
  ];

  const detailsBlock = [
    { text: "RECEIPT DETAILS", style: "blockLabel" },
    {
      table: {
        widths: ["auto", "*"],
        body: [
          [{ text: "Reference:", style: "metaKey" }, { text: formatLongString(txn.reference || "—", 24), style: "metaVal" }],
          [{ text: "Date:", style: "metaKey" }, { text: ukDateTime(txn.createdAt), style: "metaVal" }],
          [{ text: "Gateway:", style: "metaKey" }, { text: txn.gateway || "N/A", style: "metaVal" }],
          [{ text: "Method:", style: "metaKey" }, { text: txn.payment_method || "N/A", style: "metaVal" }],
          [{ text: "Status:", style: "metaKey" }, { text: (txn.status || "—").toUpperCase(), style: "metaVal", color: statusColour, bold: true }],
          [{ text: "Currency:", style: "metaKey" }, { text: txn.currency || "GBP", style: "metaVal" }],
        ],
      },
      layout: "noBorders",
    },
  ];

  content.push({
    columns: [
      { stack: supplierBlock, width: 165 },
      { stack: recipientBlock, width: 165 },
      { stack: detailsBlock, width: 165 },
    ],
    columnGap: 0,
    margin: [0, 0, 0, 20],
  });

  // ── Line items table ──
  const tableColumns = taxEnabled
    ? ["*", 90, 70, 70]          // desc | gateway-ref | tax | amount
    : ["*", 120, 80];            // desc | gateway-ref | amount

  const tableHeaderCells = taxEnabled
    ? [
        { text: "Description", style: "tableHeader" },
        { text: "Gateway Ref", style: "tableHeader", alignment: "center" },
        { text: `Tax (${taxRateRaw}%)`, style: "tableHeader", alignment: "right" },
        { text: "Amount (ex. Tax)", style: "tableHeader", alignment: "right" },
      ]
    : [
        { text: "Description", style: "tableHeader" },
        { text: "Gateway Ref", style: "tableHeader", alignment: "center" },
        { text: "Amount", style: "tableHeader", alignment: "right" },
      ];

  const tableDataCells = taxEnabled
    ? [
        {
          stack: [
            { text: `${platformName} — Subscription Payment`, style: "itemDesc" },
            txn.invoice?.invoice_number ? { text: `Invoice: ${txn.invoice.invoice_number}`, style: "itemSubDesc" } : {},
            txn.gateway_reference ? { text: `Ref: ${formatLongString(txn.gateway_reference, 28)}`, style: "itemSubDesc" } : {},
          ],
        },
        { text: formatLongString(txn.gateway_reference || "N/A", 22), style: "itemCell", alignment: "center" },
        { text: formatGbp(taxAmount), style: "itemCell", alignment: "right" },
        { text: formatGbp(amountNet), style: "itemCell", alignment: "right", bold: true },
      ]
    : [
        {
          stack: [
            { text: `${platformName} — Subscription Payment`, style: "itemDesc" },
            txn.invoice?.invoice_number ? { text: `Invoice: ${txn.invoice.invoice_number}`, style: "itemSubDesc" } : {},
            txn.gateway_reference ? { text: `Ref: ${formatLongString(txn.gateway_reference, 28)}`, style: "itemSubDesc" } : {},
          ],
        },
        { text: formatLongString(txn.gateway_reference || "N/A", 22), style: "itemCell", alignment: "center" },
        { text: formatGbp(amountNet), style: "itemCell", alignment: "right", bold: true },
      ];

  content.push({
    table: {
      headerRows: 1,
      widths: tableColumns,
      body: [tableHeaderCells, tableDataCells],
    },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length) ? 1 : 0.5,
      vLineWidth: () => 0,
      hLineColor: (i) => i <= 1 ? "#1d4ed8" : "#e2e8f0",
      fillColor: (row) => row === 0 ? "#1d4ed8" : (row % 2 === 0 ? "#f8fafc" : null),
      paddingLeft: () => 8,
      paddingRight: () => 8,
      paddingTop: () => 7,
      paddingBottom: () => 7,
    },
    margin: [0, 0, 0, 14],
  });

  // ── Totals block (right-aligned, width-controlled) ──
  const totalsRows = [];
  if (taxEnabled) {
    totalsRows.push(
      [{ text: "Subtotal (ex. Tax)", style: "totalsLabel" }, { text: formatGbp(amountNet), style: "totalsVal" }],
      [{ text: `Tax @ ${taxRateRaw}%${taxId ? ` (${taxId})` : ""}`, style: "totalsLabel" }, { text: formatGbp(taxAmount), style: "totalsVal" }],
    );
  }
  totalsRows.push(
    [{ text: taxEnabled ? "TOTAL CHARGED" : "AMOUNT CHARGED", style: "totalsFinalLabel" }, { text: formatGbp(totalGross), style: "totalsFinalVal" }],
  );

  content.push({
    columns: [
      { text: "", width: "*" },
      {
        table: { widths: [140, 80], body: totalsRows },
        layout: {
          hLineWidth: (i, node) => (i === 0 || i === node.table.body.length) ? 0 : 0.5,
          vLineWidth: () => 0,
          hLineColor: () => "#e2e8f0",
          fillColor: (row, node) => row === node.table.body.length - 1 ? "#1d4ed8" : null,
          paddingLeft: () => 8,
          paddingRight: () => 8,
          paddingTop: (i, node) => i === node.table.body.length - 1 ? 8 : 5,
          paddingBottom: (i, node) => i === node.table.body.length - 1 ? 8 : 5,
        },
        width: "auto",
      },
    ],
    margin: [0, 0, 0, 20],
  });

  // ── Status note ──
  const noteText = txn.status === "completed"
    ? `Payment of ${formatGbp(totalGross)} was successfully processed on ${ukDateTime(txn.createdAt)}.`
    : txn.status === "refunded"
    ? `This transaction was refunded. Original amount: ${formatGbp(totalGross)}.`
    : txn.failure_reason
    ? `Transaction failed: ${txn.failure_reason}`
    : `Transaction status: ${txn.status}.`;

  content.push({
    stack: [
      { text: txn.status === "completed" ? "✓ Payment Confirmed" : "Transaction Note", style: "notesTitle",
        color: txn.status === "completed" ? "#16a34a" : "#d97706" },
      { text: noteText, style: "notesBody" },
    ],
    margin: [0, 0, 0, 16],
  });

  // ── Footer ──
  content.push({
    canvas: [{ type: "line", x1: 0, y1: 0, x2: 495, y2: 0, lineWidth: 0.5, lineColor: "#cbd5e1" }],
    margin: [0, 0, 0, 6],
  });
  content.push({
    text: `${platformName} · ${supportEmail} · Computer-generated. No signature required.`,
    style: "footerNote",
    alignment: "center",
  });

  return {
    pageSize: "A4",
    pageMargins: [52, 52, 52, 60],
    content,
    images,
    footer: (currentPage, pageCount) => ({
      margin: [52, 8, 52, 0],
      columns: [
        { text: `${platformName} — Confidential`, style: "footerText", width: "*" },
        { text: `Page ${currentPage} of ${pageCount}`, style: "footerText", alignment: "right", width: "auto" },
      ],
    }),
    styles: {
      receiptTitle:     { fontSize: 20, bold: true, color: "#1e293b" },
      receiptRef:       { fontSize: 9, color: "#64748b", margin: [0, 3, 0, 0] },
      supplierName:     { fontSize: 15, bold: true, color: "#1e293b" },
      blockLabel:       { fontSize: 7, bold: true, color: "#94a3b8", margin: [0, 0, 0, 3] },
      blockCompany:     { fontSize: 10, bold: true, color: "#1e293b", margin: [0, 0, 0, 1] },
      blockDetail:      { fontSize: 8, color: "#475569", margin: [0, 1, 0, 0] },
      metaKey:          { fontSize: 8, color: "#64748b", margin: [0, 1, 4, 1] },
      metaVal:          { fontSize: 8, bold: true, color: "#1e293b", margin: [0, 1, 0, 1] },
      tableHeader:      { fontSize: 8, bold: true, color: "#ffffff" },
      itemDesc:         { fontSize: 9, bold: true, color: "#1e293b" },
      itemSubDesc:      { fontSize: 7, color: "#64748b", margin: [0, 1, 0, 0] },
      itemCell:         { fontSize: 9, color: "#1e293b" },
      totalsLabel:      { fontSize: 9, color: "#475569" },
      totalsVal:        { fontSize: 9, color: "#1e293b", alignment: "right" },
      totalsFinalLabel: { fontSize: 10, bold: true, color: "#ffffff" },
      totalsFinalVal:   { fontSize: 10, bold: true, color: "#ffffff", alignment: "right" },
      notesTitle:       { fontSize: 8, bold: true, color: "#334155", margin: [0, 0, 0, 3] },
      notesBody:        { fontSize: 7.5, color: "#64748b", lineHeight: 1.4 },
      footerNote:       { fontSize: 7, color: "#94a3b8" },
      footerText:       { fontSize: 7, color: "#94a3b8" },
    },
    defaultStyle: { font: "Helvetica", fontSize: 9, color: "#1e293b" },
  };
}



export const getAllTransactions = catchAsync(async (req, res) => {
  const { status, gateway, type } = req.query;
  const where = {};

  if (status) where.status = status;
  if (gateway) where.gateway = gateway;

  const { page, limit, offset } = getPaginationParams(req.query);

  const { count, rows: transactions } = await platformDb.PaymentTransaction.findAndCountAll({
    where,
    include: [
      {
        model: platformDb.Organisation,
        as: "organisation",
        attributes: ["id", "name", "slug"],
      },
      {
        model: platformDb.Invoice,
        as: "invoice",
        attributes: ["id", "invoice_number", "amount"],
      },
    ],
    order: [["createdAt", "DESC"]],
    limit,
    offset,
  });

  return ApiResponse.success(res, "Transactions retrieved successfully", {
    transactions,
    pagination: buildPaginationMeta(count, page, limit),
  });
});

/**
 * Export platform payment transactions as a real .xlsx file.
 * Honours the same `status`/`gateway` filters as getAllTransactions so the
 * download matches whatever the operator is viewing. Data is pulled live from
 * the PaymentTransaction table — no mock rows.
 */
export const exportTransactions = catchAsync(async (req, res) => {
  const { status, gateway } = req.query;
  const where = {};
  if (status) where.status = status;
  if (gateway) where.gateway = gateway;

  const transactions = await platformDb.PaymentTransaction.findAll({
    where,
    include: [
      {
        model: platformDb.Organisation,
        as: "organisation",
        attributes: ["id", "name", "slug"],
      },
      {
        model: platformDb.Invoice,
        as: "invoice",
        attributes: ["id", "invoice_number"],
      },
    ],
    order: [["createdAt", "DESC"]],
  });

  const columns = [
    { key: "reference", header: "Reference" },
    { key: "organisation", header: "Organisation" },
    { key: "amount", header: "Amount" },
    { key: "currency", header: "Currency" },
    { key: "status", header: "Status" },
    { key: "gateway", header: "Gateway" },
    { key: "payment_method", header: "Payment Method" },
    { key: "invoice_number", header: "Invoice Number" },
    { key: "gateway_reference", header: "Gateway Reference" },
    { key: "failure_reason", header: "Failure Reason" },
    { key: "date", header: "Date" },
  ];

  const rows = transactions.map((txn) => ({
    reference: txn.reference,
    organisation: txn.organisation?.name || "—",
    amount: txn.amount,
    currency: txn.currency,
    status: txn.status,
    gateway: txn.gateway || "—",
    payment_method: txn.payment_method || "—",
    invoice_number: txn.invoice?.invoice_number || "—",
    gateway_reference: txn.gateway_reference || "—",
    failure_reason: txn.failure_reason || "",
    date: txn.createdAt ? new Date(txn.createdAt).toLocaleString("en-GB") : "—",
  }));

  const buffer = rowsToXlsxBuffer(rows, columns);
  sendXlsxDownload(res, buffer, `transactions_export_${Date.now()}.xlsx`);
});

export const getTransactionById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const transaction = await platformDb.PaymentTransaction.findByPk(id, {
    include: [
      {
        model: platformDb.Organisation,
        as: "organisation",
        attributes: ["id", "name", "slug", "primaryEmail", "country", "logoUrl"],
      },
      {
        model: platformDb.Invoice,
        as: "invoice",
        attributes: [
          "id", "invoice_number", "amount", "status",
          "subtotal", "platform_fee_amount", "tax_rate", "tax_amount", "total",
        ],
      },
    ],
  });

  if (!transaction) {
    return ApiResponse.notFound(res, "Transaction not found");
  }

  return ApiResponse.success(res, "Transaction retrieved successfully", { transaction });
});

export const downloadTransactionReceipt = catchAsync(async (req, res) => {
  const { id } = req.params;

  const txn = await platformDb.PaymentTransaction.findByPk(id, {
    include: [
      {
        model: platformDb.Organisation,
        as: "organisation",
        attributes: ["id", "name", "slug", "primaryEmail", "country", "logoUrl"],
      },
      {
        model: platformDb.Invoice,
        as: "invoice",
        attributes: [
          "id", "invoice_number", "amount", "status",
          "subtotal", "platform_fee_amount", "tax_rate", "tax_amount", "total",
        ],
      },
    ],
  });

  if (!txn) {
    return ApiResponse.notFound(res, "Transaction not found");
  }

  const platformSettings = await getSettingsByNamespace(null);
  const docDefinition = await buildUkReceiptDocDef(txn, platformSettings);
  const buffer = await generatePdfBufferFromDefinition(docDefinition);

  const safeRef = (txn.reference || `TXN_${id}`).replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `Receipt_${safeRef}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(buffer);
});


export const getPaymentReconciliation = catchAsync(async (req, res) => {
  const { page = 1, limit = 50, status } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const where = {};
  if (status && status !== 'all') where.processing_status = status;

  const { count, rows } = await platformDb.StripeWebhookEvent.findAndCountAll({
    where,
    order:  [['created_at', 'DESC']],
    limit:  parseInt(limit),
    offset,
  });

  const reconciliation = rows.map(r => ({
    id:            `#EVT-${r.id}`,
    eventId:       r.event_id,
    eventType:     r.event_type,
    tenantId:      r.tenant_id || 'Platform',
    accountId:     r.stripe_account_id || 'N/A',
    status:        r.processing_status,
    failureReason: r.processing_status === 'failed' ? r.error_message : null,
    date:          r.created_at ? new Date(r.created_at).toISOString() : null,
  }));

  return ApiResponse.success(res, 'Global payment reconciliation retrieved', {
    reconciliation,
    pagination: {
      total: count,
      page:  parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(count / parseInt(limit)),
    },
  });
});

export const getGatewayStatus = catchAsync(async (req, res) => {
  const rows = await platformDb.PlatformSetting.findAll({
    where: { key: ['stripe_publishable_key', 'stripe_secret_key', 'stripe_webhook_secret', 'stripe_currency', 'platform_fee', 'tax_rate', 'tax_id', 'free_trial_enabled', 'free_trial_days'] },
  });

  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });

  // Clamp legacy/out-of-range percent values on read so a stored fee/tax > 100
  // (seed, manual DB edit, or an older build) can never lock the Commerce save
  // form (the configure schema rejects > 100 — see superadminPayment.validation).
  const clampPct = (v, dflt) => {
    if (v == null || v === '') return dflt;
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return String(Math.min(100, Math.max(0, n)));
  };

  const configured = !!(settings.stripe_secret_key && settings.stripe_publishable_key);

  const lastTransaction = await platformDb.PaymentTransaction.findOne({
    where: { gateway: 'Stripe' },
    order: [["createdAt", "DESC"]],
  });

  return ApiResponse.success(res, "Gateway status retrieved", {
    gateway: {
      name: "Stripe",
      status: configured ? "Connected" : "Not Configured",
      lastSync: lastTransaction ? new Date(lastTransaction.createdAt).toISOString() : null,
      publishable_key: settings.stripe_publishable_key || '',
      currency: settings.stripe_currency || 'GBP',
      platform_fee: clampPct(settings.platform_fee, '0'),
      secret_key_set: !!settings.stripe_secret_key,
      webhook_secret_set: !!settings.stripe_webhook_secret,
      tax_rate: clampPct(settings.tax_rate, ''),
      tax_id:   settings.tax_id   || '',
      free_trial_enabled: settings.free_trial_enabled !== 'false',
      free_trial_days: parseInt(settings.free_trial_days || '14', 10),
    },
  });
});

export const configureGateway = catchAsync(async (req, res) => {
  const { publishable_key, secret_key, webhook_secret, currency, platform_fee, tax_rate: taxRateInput, tax_id: taxIdInput, free_trial_enabled, free_trial_days } =
    req.validated.body;

  // platform_fee & tax_rate are validated as numeric percents (0-100); persist as strings.
  const tax_rate = taxRateInput != null ? String(taxRateInput).trim() : null;
  const tax_id   = taxIdInput   != null ? String(taxIdInput).trim()   : null;

  const upserts = [];
  if (publishable_key !== undefined && publishable_key !== null) {
    upserts.push({ key: 'stripe_publishable_key', value: String(publishable_key).trim() });
  }
  if (secret_key !== undefined && secret_key !== null) {
    upserts.push({ key: 'stripe_secret_key', value: String(secret_key).trim() });
  }
  if (webhook_secret !== undefined) {
    upserts.push({ key: 'stripe_webhook_secret', value: webhook_secret ? String(webhook_secret).trim() : null });
  }
  if (currency !== undefined && currency !== null) {
    upserts.push({ key: 'stripe_currency', value: String(currency).trim().toUpperCase() });
  }
  if (platform_fee !== undefined && platform_fee !== null) {
    upserts.push({ key: 'platform_fee', value: String(platform_fee).trim() });
  }

  if (tax_rate !== null) upserts.push({ key: 'tax_rate', value: tax_rate });
  if (tax_id   !== null) upserts.push({ key: 'tax_id',   value: tax_id   });
  if (free_trial_enabled !== undefined && free_trial_enabled !== null) {
    upserts.push({ key: 'free_trial_enabled', value: String(free_trial_enabled) });
  }
  if (free_trial_days !== undefined && free_trial_days !== null) {
    upserts.push({ key: 'free_trial_days', value: String(free_trial_days) });
  }

  for (const item of upserts) {
    await platformDb.PlatformSetting.upsert(item, { conflictFields: ['key'] });
  }

  return ApiResponse.success(res, "Gateway configuration saved successfully");
});

export const getDashboardStats = catchAsync(async (req, res) => {
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  // ── Organisation stats ──────────────────────────────────────────────────────
  const [totalOrgs, activeOrgs, trialOrgs, suspendedOrgs] = await Promise.all([
    platformDb.Organisation.count(),
    platformDb.Organisation.count({ where: { status: "active" } }),
    platformDb.Organisation.count({ where: { status: "trial" } }),
    platformDb.Organisation.count({ where: { status: "suspended" } }),
  ]);

  const newOrgsThisMonth = await platformDb.Organisation.count({
    where: { createdAt: { [Op.gte]: firstDayOfMonth, [Op.lte]: lastDayOfMonth } },
  });

  // ── User stats ──────────────────────────────────────────────────────────────
  const totalUsers = await platformDb.User.count();
  const newUsersThisMonth = await platformDb.User.count({
    where: { createdAt: { [Op.gte]: firstDayOfMonth, [Op.lte]: lastDayOfMonth } },
  });

  // ── Subscription stats ──────────────────────────────────────────────────────
  const activeSubscriptions = await platformDb.Subscription.findAll({
    where: { status: "active" },
    include: [{ model: platformDb.Plan, as: "plan", attributes: ["price", "billing_cycle"] }],
  });

  let mrr = 0;
  activeSubscriptions.forEach((sub) => {
    if (sub.plan) {
      const price = parseFloat(sub.plan.price) || 0;
      if (sub.plan.billing_cycle === "monthly") mrr += price;
      else if (sub.plan.billing_cycle === "yearly") mrr += price / 12;
    }
  });

  const arr = mrr * 12;

  const [activeSubCount, trialSubCount, expiredSubCount, cancelledSubCount] = await Promise.all([
    platformDb.Subscription.count({ where: { status: "active" } }),
    platformDb.Subscription.count({ where: { status: "trial" } }),
    platformDb.Subscription.count({ where: { status: "expired" } }),
    platformDb.Subscription.count({ where: { status: "cancelled" } }),
  ]);

  const cancelledThisMonth = await platformDb.Subscription.count({
    where: {
      status: "cancelled",
      cancelled_at: { [Op.gte]: firstDayOfMonth, [Op.lte]: lastDayOfMonth },
    },
  });

  const totalSubsThisMonth = await platformDb.Subscription.count({
    where: { createdAt: { [Op.gte]: firstDayOfMonth, [Op.lte]: lastDayOfMonth } },
  });

  const churnRate = totalSubsThisMonth > 0 ? (cancelledThisMonth / totalSubsThisMonth) * 100 : 0;

  // ── Plan distribution ───────────────────────────────────────────────────────
  const plans = await platformDb.Plan.findAll({
    attributes: ["id", "name", "price", "billing_cycle"],
    order: [["id", "ASC"]],
  });

  const planDistribution = await Promise.all(
    plans.map(async (plan) => {
      const orgCount = await platformDb.Organisation.count({ where: { plan_id: plan.id } });
      return { id: plan.id, name: plan.name, price: plan.price, billing_cycle: plan.billing_cycle, orgCount };
    }),
  );

  const orgsWithNoPlan = await platformDb.Organisation.count({ where: { plan_id: null } });

  // ── Transaction stats ───────────────────────────────────────────────────────
  const completedTransactions = await platformDb.PaymentTransaction.findAll({
    where: {
      status: "completed",
      createdAt: { [Op.gte]: firstDayOfMonth, [Op.lte]: lastDayOfMonth },
    },
  });

  const grossVolume = completedTransactions.reduce((sum, txn) => sum + (parseFloat(txn.amount) || 0), 0);
  const netRevenue = grossVolume * 0.97;

  const totalTransactions = await platformDb.PaymentTransaction.count({
    where: { createdAt: { [Op.gte]: firstDayOfMonth, [Op.lte]: lastDayOfMonth } },
  });

  const successfulTransactions = await platformDb.PaymentTransaction.count({
    where: { status: "completed", createdAt: { [Op.gte]: firstDayOfMonth, [Op.lte]: lastDayOfMonth } },
  });

  const refundedTransactions = await platformDb.PaymentTransaction.count({
    where: { status: "refunded", createdAt: { [Op.gte]: firstDayOfMonth, [Op.lte]: lastDayOfMonth } },
  });

  const successRate = totalTransactions > 0 ? (successfulTransactions / totalTransactions) * 100 : 0;
  const refundRate = totalTransactions > 0 ? (refundedTransactions / totalTransactions) * 100 : 0;

  // ── Invoice stats ───────────────────────────────────────────────────────────
  const [pendingInvoices, overdueInvoices] = await Promise.all([
    platformDb.Invoice.count({ where: { status: "pending" } }),
    platformDb.Invoice.count({ where: { status: "overdue" } }),
  ]);

  // ── Monthly revenue trend (last 12 months) ─────────────────────────────────
  const monthlyRevenue = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

    const monthTxns = await platformDb.PaymentTransaction.findAll({
      where: { status: "completed", createdAt: { [Op.gte]: monthStart, [Op.lte]: monthEnd } },
      attributes: ["amount"],
    });

    const total = monthTxns.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
    const label = monthStart.toLocaleString("en-GB", { month: "short", year: "2-digit" });

    monthlyRevenue.push({ month: label, amount: parseFloat(total.toFixed(2)) });
  }

  // ── Recent organisations ────────────────────────────────────────────────────
  const recentOrgs = await platformDb.Organisation.findAll({
    order: [["createdAt", "DESC"]],
    limit: 10,
    include: [
      { model: platformDb.Plan, as: "plan", attributes: ["name", "price", "billing_cycle"] },
      { model: platformDb.User, as: "users", attributes: ["id"] },
    ],
  });

  const recentOrganisations = recentOrgs.map((org) => ({
    id: org.id,
    name: org.name,
    slug: org.slug,
    status: org.status,
    plan: org.plan?.name || "No Plan",
    planPrice: org.plan?.price || "0",
    billingCycle: org.plan?.billing_cycle || null,
    userCount: org.users?.length || 0,
    country: org.country || "—",
    createdAt: org.createdAt,
  }));

  return ApiResponse.success(res, "Dashboard stats retrieved successfully", {
    stats: {
      organisations: {
        total: totalOrgs,
        active: activeOrgs,
        trial: trialOrgs,
        suspended: suspendedOrgs,
        newThisMonth: newOrgsThisMonth,
      },
      users: {
        total: totalUsers,
        newThisMonth: newUsersThisMonth,
      },
      subscriptions: {
        active: activeSubCount,
        trial: trialSubCount,
        expired: expiredSubCount,
        cancelled: cancelledSubCount,
        churnRate: parseFloat(churnRate.toFixed(2)),
      },
      revenue: {
        mrr: parseFloat(mrr.toFixed(2)),
        arr: parseFloat(arr.toFixed(2)),
        grossVolume: parseFloat(grossVolume.toFixed(2)),
        netRevenue: parseFloat(netRevenue.toFixed(2)),
      },
      transactions: {
        total: totalTransactions,
        successful: successfulTransactions,
        refunded: refundedTransactions,
        successRate: parseFloat(successRate.toFixed(2)),
        refundRate: parseFloat(refundRate.toFixed(2)),
      },
      invoices: {
        pending: pendingInvoices,
        overdue: overdueInvoices,
      },
      planDistribution,
      orgsWithNoPlan,
      monthlyRevenue,
      recentOrganisations,
    },
  });
});
