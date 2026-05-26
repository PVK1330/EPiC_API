/**
 * Admin Finance Controller
 * Handles tenant-level case payment management for the admin panel.
 * Platform-level (SaaS) billing is handled by the Superadmin module.
 */
import { Op, fn, col, literal } from 'sequelize';
import catchAsync from '../../../utils/catchAsync.js';
import ApiResponse from '../../../utils/apiResponse.js';

// ─── GET /admin/finance/summary ───────────────────────────────────────────────
export const getFinanceSummary = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;

  const dateWhere = {};
  if (startDate) dateWhere[Op.gte] = new Date(startDate);
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    dateWhere[Op.lte] = end;
  }
  const createdAtWhere = Object.keys(dateWhere).length ? { created_at: dateWhere } : {};

  const [totalRevenue, outstanding, refunded, thisMonth] = await Promise.all([
    req.tenantDb.CasePayment.findOne({
      where: { paymentStatus: 'completed', ...createdAtWhere },
      attributes: [[fn('SUM', col('amount')), 'total'], [fn('COUNT', col('id')), 'count']],
      raw: true,
    }).catch(() => null),

    req.tenantDb.CasePayment.findOne({
      where: { paymentStatus: 'pending', ...createdAtWhere },
      attributes: [[fn('SUM', col('amount')), 'total']],
      raw: true,
    }).catch(() => null),

    req.tenantDb.CasePayment.findOne({
      where: { paymentStatus: 'refunded', ...createdAtWhere },
      attributes: [[fn('SUM', col('amount')), 'total']],
      raw: true,
    }).catch(() => null),

    req.tenantDb.CasePayment.findOne({
      where: {
        paymentStatus: 'completed',
        created_at: { [Op.gte]: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
      attributes: [[fn('SUM', col('amount')), 'total']],
      raw: true,
    }).catch(() => null),
  ]);

  return ApiResponse.success(res, 'Finance summary retrieved', {
    summary: {
      totalRevenue:    parseFloat(totalRevenue?.total  || 0),
      totalPaid:       parseInt(totalRevenue?.count    || 0),
      totalOutstanding: parseFloat(outstanding?.total  || 0),
      totalRefunded:   parseFloat(refunded?.total      || 0),
      thisMonthRevenue: parseFloat(thisMonth?.total    || 0),
    },
  });
});

// ─── GET /admin/finance/transactions ─────────────────────────────────────────
export const getTransactions = catchAsync(async (req, res) => {
  const { page = 1, limit = 20, status, paymentMethod, startDate, endDate } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const where = {};
  if (status && status !== 'all') where.paymentStatus = status;
  if (paymentMethod && paymentMethod !== 'all') where.paymentMethod = paymentMethod;
  if (startDate || endDate) {
    const range = {};
    if (startDate) range[Op.gte] = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      range[Op.lte] = end;
    }
    where.created_at = range;
  }

  const { count, rows } = await req.tenantDb.CasePayment.findAndCountAll({
    where,
    include: [{
      model:      req.tenantDb.Case,
      attributes: ['caseId', 'status'],
      required:   false,
      include: [{
        model:      req.tenantDb.User,
        as:         'candidate',
        attributes: ['first_name', 'last_name'],
      }],
    }],
    order:  [['created_at', 'DESC']],
    limit:  parseInt(limit),
    offset,
  });

  const transactions = rows.map(r => ({
    id:            `#PAY-${r.id}`,
    rawId:         r.id,
    client:        r.Case?.candidate
      ? `${r.Case.candidate.first_name} ${r.Case.candidate.last_name}`
      : 'Unknown',
    caseId:        r.Case?.caseId || 'N/A',
    amount:        `£${parseFloat(r.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`,
    rawAmount:     parseFloat(r.amount),
    type:          r.paymentType   || 'fee',
    paymentMethod: r.paymentMethod || 'N/A',
    status:        r.paymentStatus === 'completed' ? 'Paid'
      : r.paymentStatus === 'pending'   ? 'Pending'
      : r.paymentStatus === 'refunded'  ? 'Refunded'
      : r.paymentStatus === 'failed'    ? 'Failed'
      : 'Processed',
    rawStatus:     r.paymentStatus,
    date:          new Date(r.created_at).toISOString().split('T')[0],
    invoiceNumber: r.invoiceNumber || null,
    description:   r.description   || null,
    transactionId: r.transactionId || null,
    dueDate:       r.dueDate       || null,
  }));

  return ApiResponse.success(res, 'Transactions retrieved', {
    transactions,
    pagination: {
      total: count,
      page:  parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(count / parseInt(limit)),
    },
  });
});

// ─── GET /admin/finance/transactions/:id ─────────────────────────────────────
export const getTransactionById = catchAsync(async (req, res) => {
  const { id } = req.params;

  const payment = await req.tenantDb.CasePayment.findByPk(id, {
    include: [{
      model:      req.tenantDb.Case,
      attributes: ['caseId', 'status', 'totalAmount', 'paidAmount'],
      include: [
        { model: req.tenantDb.User, as: 'candidate', attributes: ['first_name', 'last_name', 'email'] },
        { model: req.tenantDb.User, as: 'sponsor',   attributes: ['first_name', 'last_name'] },
      ],
    }],
  });

  if (!payment) return ApiResponse.notFound(res, 'Transaction not found');

  return ApiResponse.success(res, 'Transaction retrieved', { transaction: payment });
});

// ─── POST /admin/finance/invoices ─────────────────────────────────────────────
/**
 * Create a case payment record (admin-generated invoice/charge).
 * Body: { caseId, amount, paymentType, paymentMethod, dueDate, description, invoiceNumber, notes }
 */
export const createInvoice = catchAsync(async (req, res) => {
  const {
    caseId,
    amount,
    paymentType   = 'fee',
    paymentMethod = 'bank_transfer',
    dueDate,
    description,
    invoiceNumber,
    notes,
  } = req.body;

  if (!caseId || !amount) {
    return ApiResponse.badRequest(res, 'caseId and amount are required');
  }

  // Resolve the case
  const caseRecord = await req.tenantDb.Case.findOne({
    where: { caseId },
  });
  if (!caseRecord) return ApiResponse.notFound(res, `Case ${caseId} not found`);

  const autoInvoiceNumber = invoiceNumber
    || `INV-${Date.now()}-${caseRecord.id}`;

  const payment = await req.tenantDb.CasePayment.create({
    caseId:        caseRecord.id,
    amount:        parseFloat(amount),
    paymentType,
    paymentMethod,
    paymentDate:   new Date().toISOString().split('T')[0],
    paymentStatus: 'pending',
    invoiceNumber: autoInvoiceNumber,
    description,
    dueDate:       dueDate || null,
    notes,
    receivedBy:    req.user?.id || null,
  });

  return ApiResponse.created(res, 'Invoice created successfully', { payment });
});

// ─── PATCH /admin/finance/transactions/:id/status ────────────────────────────
export const updateTransactionStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowed = ['pending', 'completed', 'failed', 'refunded'];
  if (!status || !allowed.includes(status)) {
    return ApiResponse.badRequest(res, `status must be one of: ${allowed.join(', ')}`);
  }

  const payment = await req.tenantDb.CasePayment.findByPk(id);
  if (!payment) return ApiResponse.notFound(res, 'Transaction not found');

  await payment.update({ paymentStatus: status });

  return ApiResponse.success(res, 'Transaction status updated', { payment });
});

// ─── GET /admin/finance/export/csv ───────────────────────────────────────────
export const exportTransactionsCsv = catchAsync(async (req, res) => {
  const { startDate, endDate, status } = req.query;

  const where = {};
  if (status && status !== 'all') where.paymentStatus = status;
  if (startDate || endDate) {
    const range = {};
    if (startDate) range[Op.gte] = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      range[Op.lte] = end;
    }
    where.created_at = range;
  }

  const rows = await req.tenantDb.CasePayment.findAll({
    where,
    include: [{
      model:      req.tenantDb.Case,
      attributes: ['caseId'],
      required:   false,
      include: [{
        model:      req.tenantDb.User,
        as:         'candidate',
        attributes: ['first_name', 'last_name'],
      }],
    }],
    order: [['created_at', 'DESC']],
  });

  const esc = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
  let csv = '\uFEFFDate,Invoice Number,Client,Case ID,Amount,Payment Method,Status,Description\n';

  rows.forEach(r => {
    const client = r.Case?.candidate
      ? `${r.Case.candidate.first_name} ${r.Case.candidate.last_name}`
      : 'Unknown';
    csv += [
      esc(new Date(r.created_at).toLocaleDateString()),
      esc(r.invoiceNumber),
      esc(client),
      esc(r.Case?.caseId || 'N/A'),
      esc(parseFloat(r.amount).toFixed(2)),
      esc(r.paymentMethod),
      esc(r.paymentStatus),
      esc(r.description),
    ].join(',') + '\n';
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=Finance_Export_${new Date().toISOString().slice(0, 10)}.csv`,
  );
  return res.status(200).send(csv);
});
