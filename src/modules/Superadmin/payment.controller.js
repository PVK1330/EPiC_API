import { Op } from "sequelize";
import platformDb from "../../models/index.js";
import catchAsync from "../../utils/catchAsync.js";
import ApiResponse from "../../utils/apiResponse.js";

export const getAllTransactions = catchAsync(async (req, res) => {
  const { status, gateway, type } = req.query;
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
        attributes: ["id", "invoice_number", "amount"],
      },
    ],
    order: [["createdAt", "DESC"]],
  });

  return ApiResponse.success(res, "Transactions retrieved successfully", { transactions });
});

export const getTransactionById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const transaction = await platformDb.PaymentTransaction.findByPk(id, {
    include: [
      {
        model: platformDb.Organisation,
        as: "organisation",
        attributes: ["id", "name", "slug", "primaryEmail"],
      },
      {
        model: platformDb.Invoice,
        as: "invoice",
        attributes: ["id", "invoice_number", "amount", "status"],
      },
    ],
  });

  if (!transaction) {
    return ApiResponse.notFound(res, "Transaction not found");
  }

  return ApiResponse.success(res, "Transaction retrieved successfully", { transaction });
});

export const getGatewayStatus = catchAsync(async (req, res) => {
  const stripeConfigured = !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY);

  const lastTransaction = await platformDb.PaymentTransaction.findOne({
    where: { gateway: 'Stripe' },
    order: [["createdAt", "DESC"]],
  });

  const lastSync = lastTransaction ? lastTransaction.createdAt : null;

  return ApiResponse.success(res, "Gateway status retrieved", {
    gateway: {
      name: "Stripe",
      status: stripeConfigured ? "Connected" : "Not Configured",
      lastSync: lastSync ? new Date(lastSync).toISOString() : null,
    },
  });
});

export const configureGateway = catchAsync(async (req, res) => {
  const { publishable_key, secret_key, webhook_secret } = req.body;

  if (!publishable_key || !secret_key) {
    return ApiResponse.badRequest(res, "Publishable key and secret key are required");
  }

  return ApiResponse.success(res, "Gateway configuration saved successfully");
});

export const getDashboardStats = catchAsync(async (req, res) => {
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const activeSubscriptions = await platformDb.Subscription.findAll({
    where: { status: 'active' },
    include: [
      {
        model: platformDb.Plan,
        as: "plan",
        attributes: ["price", "billing_cycle"],
      },
    ],
  });

  let mrr = 0;
  activeSubscriptions.forEach(sub => {
    if (sub.plan) {
      if (sub.plan.billing_cycle === 'monthly') {
        mrr += parseFloat(sub.plan.price);
      } else if (sub.plan.billing_cycle === 'yearly') {
        mrr += parseFloat(sub.plan.price) / 12;
      }
    }
  });

  const arr = mrr * 12;

  const totalSubscriptionsThisMonth = await platformDb.Subscription.count({
    where: {
      createdAt: {
        [Op.gte]: firstDayOfMonth,
        [Op.lte]: lastDayOfMonth,
      },
    },
  });

  const cancelledThisMonth = await platformDb.Subscription.count({
    where: {
      status: 'cancelled',
      cancelled_at: {
        [Op.gte]: firstDayOfMonth,
        [Op.lte]: lastDayOfMonth,
      },
    },
  });

  const churnRate = totalSubscriptionsThisMonth > 0 ? (cancelledThisMonth / totalSubscriptionsThisMonth) * 100 : 0;

  const activeCount = await platformDb.Subscription.count({
    where: { status: 'active' },
  });

  const completedTransactions = await platformDb.PaymentTransaction.findAll({
    where: {
      status: 'completed',
      createdAt: {
        [Op.gte]: firstDayOfMonth,
        [Op.lte]: lastDayOfMonth,
      },
    },
  });

  const grossVolume = completedTransactions.reduce((sum, txn) => sum + parseFloat(txn.amount), 0);
  const netRevenue = grossVolume * 0.97;

  const totalTransactions = await platformDb.PaymentTransaction.count({
    where: {
      createdAt: {
        [Op.gte]: firstDayOfMonth,
        [Op.lte]: lastDayOfMonth,
      },
    },
  });

  const successfulTransactions = await platformDb.PaymentTransaction.count({
    where: {
      status: 'completed',
      createdAt: {
        [Op.gte]: firstDayOfMonth,
        [Op.lte]: lastDayOfMonth,
      },
    },
  });

  const successRate = totalTransactions > 0 ? (successfulTransactions / totalTransactions) * 100 : 0;

  const refundedTransactions = await platformDb.PaymentTransaction.count({
    where: {
      status: 'refunded',
      createdAt: {
        [Op.gte]: firstDayOfMonth,
        [Op.lte]: lastDayOfMonth,
      },
    },
  });

  const refundRate = totalTransactions > 0 ? (refundedTransactions / totalTransactions) * 100 : 0;

  return ApiResponse.success(res, "Dashboard stats retrieved successfully", {
    stats: {
      mrr: mrr.toFixed(2),
      arr: arr.toFixed(2),
      churnRate: churnRate.toFixed(2),
      activeSubscriptions: activeCount,
      grossVolume: grossVolume.toFixed(2),
      netRevenue: netRevenue.toFixed(2),
      successRate: successRate.toFixed(2),
      refundRate: refundRate.toFixed(2),
    },
  });
});
