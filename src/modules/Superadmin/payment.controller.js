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
  const rows = await platformDb.PlatformSetting.findAll({
    where: { key: ['stripe_publishable_key', 'stripe_secret_key', 'stripe_webhook_secret', 'stripe_currency', 'platform_fee'] },
  });

  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });

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
      webhook_secret: settings.stripe_webhook_secret || '',
      currency: settings.stripe_currency || 'GBP',
      platform_fee: settings.platform_fee || '0',
      secret_key_set: !!settings.stripe_secret_key,
    },
  });
});

export const configureGateway = catchAsync(async (req, res) => {
  const { publishable_key, secret_key, webhook_secret, currency, platform_fee } = req.body;

  if (!publishable_key || !secret_key) {
    return ApiResponse.badRequest(res, "Publishable key and secret key are required");
  }

  const upserts = [
    { key: 'stripe_publishable_key', value: String(publishable_key).trim() },
    { key: 'stripe_secret_key',      value: String(secret_key).trim() },
    { key: 'stripe_webhook_secret',  value: webhook_secret ? String(webhook_secret).trim() : null },
    { key: 'stripe_currency',        value: currency ? String(currency).trim().toUpperCase() : 'GBP' },
    { key: 'platform_fee',           value: platform_fee != null ? String(platform_fee).trim() : '0' },
  ];

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
