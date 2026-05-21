import platformDb from "../../models/index.js";
import catchAsync from "../../utils/catchAsync.js";
import ApiResponse from "../../utils/apiResponse.js";
import { buildBrandedPdfDocDefinition, streamBrandedPdf } from "../../services/pdfGenerator.service.js";
import { multiSheetXlsxBuffer, sendXlsxDownload } from "../../utils/excelExport.util.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const getAllInvoices = catchAsync(async (req, res) => {
  const invoices = await platformDb.Invoice.findAll({
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

  const sections = invoices.map(inv => ({
    sectionTitle: `Invoice ${inv.invoice_number}`,
    rows: [
      { label: "Organisation", value: inv.organisation?.name || "—" },
      { label: "Plan", value: inv.subscription?.plan?.name || "—" },
      { label: "Amount", value: `£${inv.amount}` },
      { label: "Status", value: inv.status },
      { label: "Due Date", value: inv.due_at ? new Date(inv.due_at).toLocaleDateString() : "—" },
    ],
  }));

  const logoPath = path.join(__dirname, "../../assets/elitepic_logo.png");

  streamBrandedPdf(res, "invoices_export.pdf", {
    logoPath,
    title: "Invoices Export",
    sections,
    metadata: {
      subtitle: "Platform Billing Report",
      reference: `Generated ${new Date().toLocaleDateString()}`,
    },
  });
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
