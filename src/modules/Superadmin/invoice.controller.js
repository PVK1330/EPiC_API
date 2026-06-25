import platformDb from "../../models/index.js";
import catchAsync from "../../utils/catchAsync.js";
import ApiResponse from "../../utils/apiResponse.js";
import { generatePdfBufferFromDefinition } from "../../services/pdfGenerator.service.js";
import { buildBrandedPdfDocDefinition, generateBrandedPdfBuffer } from "../../services/pdfGenerator.service.js";
import { multiSheetXlsxBuffer, sendXlsxDownload } from "../../utils/excelExport.util.js";
import { getSettingsByNamespace } from "../../services/settings.service.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve a stored logo URL / path to a base64 data-URI or null. */
function resolveLogoDataUri(logoUrl) {
  if (!logoUrl) return null;
  try {
    // Pattern: api/public/images/<filename>  → storage/private/<subdir>/<filename>
    const basename = path.basename(logoUrl.split("?")[0]);
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
        const mime = ext === ".png" ? "image/png"
          : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
          : ext === ".gif" ? "image/gif" : "image/png";
        return `data:${mime};base64,${buf.toString("base64")}`;
      }
    }
  } catch {
    // Silently ignore — render without logo
  }
  return null;
}

/** Format pence/decimal amount as £X,XXX.XX */
function formatGbp(amount) {
  const n = parseFloat(amount || 0);
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Date as DD/MM/YYYY (UK format) */
function ukDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatLongString(str, maxLength = 25) {
  if (!str) return "";
  const s = String(str);
  if (s.length <= maxLength) return s;
  const keep = Math.floor((maxLength - 3) / 2);
  return s.slice(0, keep) + "..." + s.slice(-keep);
}

/**
 * Build a UK-compliant invoice PDF document definition.
 * UK requirements: supplier name/address, customer name/address, invoice number,
 * invoice date, supply date, itemised amounts, VAT number if applicable, total.
 */
async function buildUkInvoiceDocDef(invoice, platformSettings) {
  const org = invoice.organisation || {};
  const plan = invoice.subscription?.plan || {};

  const platformName = platformSettings["platform_name"] || "EPiC HRIS Platform";
  const platformLogoUrl = platformSettings["logo_url"] || null;
  const supportEmail = platformSettings["support_email"] || "support@elitepic.co.uk";

  // Taxation — prefer the invoice's persisted breakdown (invoice.amount = GROSS
  // for itemised org-subscription invoices); else fall back to the configured
  // rate for legacy rows where amount is the net subscription price.
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

  const amountNet = parseFloat((hasBreakdown ? invoice.subtotal : invoice.amount) || 0);
  const taxAmount = hasBreakdown
    ? parseFloat(invoice.tax_amount || 0)
    : (taxEnabled ? parseFloat((amountNet * taxRate).toFixed(2)) : 0);
  const totalGross = hasBreakdown
    ? parseFloat((invoice.total ?? invoice.amount) || 0)
    : parseFloat((amountNet + taxAmount).toFixed(2));

  const statusColour = invoice.status === "paid" ? "#16a34a"
    : invoice.status === "overdue" ? "#dc2626" : "#d97706";

  const images = {};
  if (logoDataUri) images.supplierLogo = logoDataUri;
  if (orgLogoDataUri) images.clientLogo = orgLogoDataUri;

  const content = [];

  // ── Header: logo left, INVOICE right ──
  content.push({
    columns: [
      logoDataUri
        ? { image: "supplierLogo", width: 120, alignment: "left" }
        : { text: platformName, style: "supplierName" },
      {
        stack: [
          { text: "INVOICE", style: "invoiceTitle", alignment: "right" },
          { text: invoice.invoice_number, style: "invoiceNumber", alignment: "right" },
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

  // ── Supplier / Bill To / Invoice Details (3 equal columns, explicit widths) ──
  const supplierBlock = [
    { text: "FROM", style: "blockLabel" },
    { text: platformName, style: "blockCompany" },
    { text: "Elite PiC Ltd", style: "blockDetail" },
    { text: "United Kingdom", style: "blockDetail" },
    { text: supportEmail, style: "blockDetail" },
    taxEnabled && taxId ? { text: `Tax No: ${taxId}`, style: "blockDetail" } : {},
  ];

  const billToBlock = [
    { text: "BILL TO", style: "blockLabel" },
    { text: org.name || "—", style: "blockCompany" },
    { text: org.primaryEmail || "—", style: "blockDetail" },
    { text: org.country || "United Kingdom", style: "blockDetail" },
  ];

  const invoiceDetailsBlock = [
    { text: "INVOICE DETAILS", style: "blockLabel" },
    {
      table: {
        widths: ["auto", "*"],
        body: [
          [{ text: "Invoice No:", style: "metaKey" }, { text: invoice.invoice_number, style: "metaVal" }],
          [{ text: "Date:", style: "metaKey" }, { text: ukDate(invoice.createdAt), style: "metaVal" }],
          [{ text: "Due:", style: "metaKey" }, { text: ukDate(invoice.due_at), style: "metaVal" }],
          [{ text: "Status:", style: "metaKey" }, { text: (invoice.status || "pending").toUpperCase(), style: "metaVal", color: statusColour, bold: true }],
          [{ text: "Currency:", style: "metaKey" }, { text: invoice.currency || "GBP", style: "metaVal" }],
        ],
      },
      layout: "noBorders",
    },
  ];

  content.push({
    columns: [
      { stack: supplierBlock, width: 165 },
      { stack: billToBlock, width: 165 },
      { stack: invoiceDetailsBlock, width: 165 },
    ],
    columnGap: 0,
    margin: [0, 0, 0, 20],
  });

  // ── Line items table — widths MUST fit within 495pt usable width ──
  // With tax: [desc, period, unit-price, tax, total] = [*, 60, 70, 65, 70]
  // Without:  [desc, period, unit-price, total] = [*, 70, 80, 80]
  const tableWidths = taxEnabled ? ["*", 58, 68, 64, 68] : ["*", 70, 85, 85];

  const tableHeaderRow = taxEnabled
    ? [
        { text: "Description", style: "tableHeader" },
        { text: "Period", style: "tableHeader", alignment: "center" },
        { text: "Unit Price", style: "tableHeader", alignment: "right" },
        { text: `Tax (${taxRateRaw}%)`, style: "tableHeader", alignment: "right" },
        { text: "Total", style: "tableHeader", alignment: "right" },
      ]
    : [
        { text: "Description", style: "tableHeader" },
        { text: "Period", style: "tableHeader", alignment: "center" },
        { text: "Unit Price", style: "tableHeader", alignment: "right" },
        { text: "Total", style: "tableHeader", alignment: "right" },
      ];

  const tableDataRow = taxEnabled
    ? [
        {
          stack: [
            { text: `${platformName} — ${plan.name || "Subscription"} Plan`, style: "itemDesc" },
            { text: `Payment: ${invoice.payment_method || "N/A"}`, style: "itemSubDesc" },
            invoice.stripe_invoice_id ? { text: `Ref: ${formatLongString(invoice.stripe_invoice_id, 28)}`, style: "itemSubDesc" } : {},
          ],
        },
        { text: plan.billing_cycle || "Monthly", style: "itemCell", alignment: "center" },
        { text: formatGbp(amountNet), style: "itemCell", alignment: "right" },
        { text: formatGbp(taxAmount), style: "itemCell", alignment: "right" },
        { text: formatGbp(totalGross), style: "itemCell", alignment: "right", bold: true },
      ]
    : [
        {
          stack: [
            { text: `${platformName} — ${plan.name || "Subscription"} Plan`, style: "itemDesc" },
            { text: `Payment: ${invoice.payment_method || "N/A"}`, style: "itemSubDesc" },
            invoice.stripe_invoice_id ? { text: `Ref: ${formatLongString(invoice.stripe_invoice_id, 28)}`, style: "itemSubDesc" } : {},
          ],
        },
        { text: plan.billing_cycle || "Monthly", style: "itemCell", alignment: "center" },
        { text: formatGbp(amountNet), style: "itemCell", alignment: "right" },
        { text: formatGbp(totalGross), style: "itemCell", alignment: "right", bold: true },
      ];

  content.push({
    table: {
      headerRows: 1,
      widths: tableWidths,
      body: [tableHeaderRow, tableDataRow],
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

  // ── Totals block (right-aligned, explicit widths) ──
  const totalsRows = [];
  if (taxEnabled) {
    totalsRows.push(
      [{ text: "Subtotal (ex. Tax)", style: "totalsLabel" }, { text: formatGbp(amountNet), style: "totalsVal" }],
      [{ text: `Tax @ ${taxRateRaw}%${taxId ? ` (${taxId})` : ""}`, style: "totalsLabel" }, { text: formatGbp(taxAmount), style: "totalsVal" }],
    );
  }
  totalsRows.push(
    [{ text: taxEnabled ? "TOTAL DUE" : "AMOUNT DUE", style: "totalsFinalLabel" }, { text: formatGbp(totalGross), style: "totalsFinalVal" }],
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

  // ── Payment instructions / notes ──
  if (invoice.status !== "paid") {
    content.push({
      stack: [
        { text: "Payment Instructions", style: "notesTitle" },
        { text: "Please quote the invoice number as the payment reference. Payment is due by the date shown above. Late payment may result in service suspension.", style: "notesBody" },
      ],
      margin: [0, 0, 0, 14],
    });
  } else {
    content.push({
      stack: [
        { text: "Payment Received — Thank You", style: "notesTitle", color: "#16a34a" },
        { text: invoice.paid_at ? `Settled on ${ukDate(invoice.paid_at)}.` : "Marked as paid.", style: "notesBody" },
      ],
      margin: [0, 0, 0, 14],
    });
  }

  // ── Footer ──
  content.push({
    canvas: [{ type: "line", x1: 0, y1: 0, x2: 495, y2: 0, lineWidth: 0.5, lineColor: "#cbd5e1" }],
    margin: [0, 0, 0, 6],
  });
  content.push({
    text: `${platformName} · ${supportEmail} · Computer-generated invoice. No signature required.`,
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
      invoiceTitle:     { fontSize: 22, bold: true, color: "#1e293b" },
      invoiceNumber:    { fontSize: 9, color: "#64748b", margin: [0, 3, 0, 0] },
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

export const getAllInvoices = catchAsync(async (req, res) => {
  const invoices = await platformDb.Invoice.findAll({
    include: [
      {
        model: platformDb.Organisation,
        as: "organisation",
        attributes: ["id", "name", "slug", "primaryEmail", "logoUrl"],
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
    order: [["createdAt", "DESC"]],
  });
  return ApiResponse.success(res, "Invoices retrieved successfully", { invoices });
});

export const getInvoiceById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const invoice = await platformDb.Invoice.findByPk(id, {
    include: [
      {
        model: platformDb.Organisation,
        as: "organisation",
        attributes: ["id", "name", "slug", "primaryEmail"],
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
    return ApiResponse.notFound(res, "Invoice not found");
  }
  return ApiResponse.success(res, "Invoice retrieved successfully", { invoice });
});

export const updateInvoiceStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return ApiResponse.badRequest(res, "Status is required");
  }

  const invoice = await platformDb.Invoice.findByPk(id);
  if (!invoice) {
    return ApiResponse.notFound(res, "Invoice not found");
  }

  await invoice.update({ status });

  return ApiResponse.success(res, "Invoice status updated successfully", { invoice });
});

export const exportInvoicesPdf = catchAsync(async (req, res) => {
  try {
    const invoices = await platformDb.Invoice.findAll({
      include: [
        {
          model: platformDb.Organisation,
          as: "organisation",
          attributes: ["id", "name", "slug"],
        },
        {
          model: platformDb.Subscription,
          as: "subscription",
          include: [
            {
              model: platformDb.Plan,
              as: "plan",
              attributes: ["name"],
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: 100,
    });

    const sections = invoices.map((inv) => ({
      sectionTitle: `Invoice ${inv.invoice_number}`,
      rows: [
        { label: "Organisation", value: inv.organisation?.name || "—" },
        { label: "Plan", value: inv.subscription?.plan?.name || "—" },
        { label: "Amount", value: `£${inv.amount}` },
        { label: "Status", value: inv.status },
        {
          label: "Due Date",
          value: inv.due_at ? new Date(inv.due_at).toLocaleDateString() : "—",
        },
      ],
    }));

    const logoPath = path.join(__dirname, "../../assets/elitepic_logo.png");

    const buffer = await generateBrandedPdfBuffer({
      logoPath,
      title: "Invoices Export",
      sections,
      metadata: {
        subtitle: "Platform Billing Report",
        reference: `Generated ${new Date().toLocaleDateString()}`,
      },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="invoices_export.pdf"');
    res.status(200).send(buffer);
  } catch (err) {
    return ApiResponse.error(res, "Failed to export invoices PDF", 500, err);
  }
});

export const downloadInvoicePdf = catchAsync(async (req, res) => {
  const { id } = req.params;

  const invoice = await platformDb.Invoice.findByPk(id, {
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
    return ApiResponse.notFound(res, "Invoice not found");
  }

  // Load platform settings (name, logo, support email)
  const platformSettings = await getSettingsByNamespace(null);

  const docDefinition = await buildUkInvoiceDocDef(invoice, platformSettings);
  const buffer = await generatePdfBufferFromDefinition(docDefinition);

  const safeNum = (invoice.invoice_number || String(id)).replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `Invoice_${safeNum}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(buffer);
});


export const exportFinancials = catchAsync(async (req, res) => {
  const invoices = await platformDb.Invoice.findAll({
    include: [
      {
        model: platformDb.Organisation,
        as: "organisation",
        attributes: ["name"],
      },
    ],
    order: [["createdAt", "DESC"]],
  });

  const transactions = await platformDb.PaymentTransaction.findAll({
    include: [
      {
        model: platformDb.Organisation,
        as: "organisation",
        attributes: ["name"],
      },
    ],
    order: [["createdAt", "DESC"]],
  });

  const sheets = [
    {
      name: "Invoices",
      columns: [
        { key: "invoice_number", header: "Invoice Number" },
        { key: "organisation", header: "Organisation" },
        { key: "amount", header: "Amount" },
        { key: "currency", header: "Currency" },
        { key: "status", header: "Status" },
        { key: "due_at", header: "Due Date" },
        { key: "paid_at", header: "Paid Date" },
      ],
      rows: invoices.map(inv => ({
        invoice_number: inv.invoice_number,
        organisation: inv.organisation?.name || "—",
        amount: inv.amount,
        currency: inv.currency,
        status: inv.status,
        due_at: inv.due_at ? new Date(inv.due_at).toLocaleDateString() : "—",
        paid_at: inv.paid_at ? new Date(inv.paid_at).toLocaleDateString() : "—",
      })),
    },
    {
      name: "Transactions",
      columns: [
        { key: "reference", header: "Reference" },
        { key: "organisation", header: "Organisation" },
        { key: "amount", header: "Amount" },
        { key: "currency", header: "Currency" },
        { key: "status", header: "Status" },
        { key: "gateway", header: "Gateway" },
        { key: "createdAt", header: "Date" },
      ],
      rows: transactions.map(txn => ({
        reference: txn.reference,
        organisation: txn.organisation?.name || "—",
        amount: txn.amount,
        currency: txn.currency,
        status: txn.status,
        gateway: txn.gateway || "—",
        createdAt: new Date(txn.createdAt).toLocaleDateString(),
      })),
    },
  ];

  const buffer = multiSheetXlsxBuffer(sheets);
  sendXlsxDownload(res, buffer, `financials_export_${Date.now()}.xlsx`);
});
