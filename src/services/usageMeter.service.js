import { Op } from "sequelize";
import platformDb from "../models/index.js";
import logger from "../utils/logger.js";

function currentPeriod() {
  const now = new Date();
  return { period_year: now.getFullYear(), period_month: now.getMonth() + 1 };
}

/**
 * Increment a usage counter for the current period.
 * Safe to call concurrently — uses upsert with atomic increment.
 */
export async function incrementUsage(organisationId, field, by = 1) {
  try {
    const { period_year, period_month } = currentPeriod();
    const [meter] = await platformDb.UsageMeter.findOrCreate({
      where: { organisation_id: organisationId, period_year, period_month },
      defaults: { organisation_id: organisationId, period_year, period_month },
    });
    await meter.increment(field, { by });
  } catch (err) {
    logger.warn({ err, organisationId, field }, "incrementUsage error");
  }
}

/**
 * Get current period usage for an organisation.
 */
export async function getCurrentUsage(organisationId) {
  const { period_year, period_month } = currentPeriod();
  const meter = await platformDb.UsageMeter.findOne({
    where: { organisation_id: organisationId, period_year, period_month },
  });
  return meter || { cases_created: 0, active_users: 0, storage_bytes: 0, api_calls: 0, workers_count: 0 };
}

/**
 * Get plan limits for an organisation.
 * Returns null limits if on unlimited plan.
 */
export async function getPlanLimits(organisationId) {
  const org = await platformDb.Organisation.findByPk(organisationId, {
    include: [{ model: platformDb.Plan, as: "plan" }],
  });
  const plan = org?.plan;
  if (!plan) return { cases: null, users: null, storage_gb: null, workers: null };

  return {
    cases: plan.max_cases ?? null,
    users: plan.max_users ?? null,
    storage_gb: plan.max_storage_gb ?? null,
    workers: plan.max_workers ?? null,
  };
}

/**
 * Check if an organisation has exceeded a plan limit.
 * Returns { exceeded: false } or { exceeded: true, field, limit, used }.
 */
export async function checkPlanLimit(organisationId, field) {
  const [usage, limits] = await Promise.all([
    getCurrentUsage(organisationId),
    getPlanLimits(organisationId),
  ]);

  const limitMap = {
    cases_created: limits.cases,
    active_users: limits.users,
    workers_count: limits.workers,
  };

  const limit = limitMap[field];
  if (limit === null || limit === undefined) return { exceeded: false };

  const used = Number(usage[field] || 0);
  if (used >= limit) {
    return { exceeded: true, field, limit, used };
  }
  return { exceeded: false, used, limit };
}

/**
 * Get usage history for last N months.
 */
export async function getUsageHistory(organisationId, months = 6) {
  const now = new Date();
  const records = await platformDb.UsageMeter.findAll({
    where: { organisation_id: organisationId },
    order: [["period_year", "DESC"], ["period_month", "DESC"]],
    limit: months,
  });
  return records;
}

/**
 * Compute usage percentage and warning level (none/warning/critical/exceeded).
 */
export async function getUsageSummary(organisationId) {
  const [usage, limits] = await Promise.all([
    getCurrentUsage(organisationId),
    getPlanLimits(organisationId),
  ]);

  const toLevel = (used, limit) => {
    if (!limit) return { pct: null, level: "unlimited" };
    const pct = Math.round((used / limit) * 100);
    const level = pct >= 100 ? "exceeded" : pct >= 90 ? "critical" : pct >= 80 ? "warning" : "ok";
    return { pct, level };
  };

  return {
    cases:   { used: usage.cases_created,  limit: limits.cases,      ...toLevel(usage.cases_created,  limits.cases) },
    users:   { used: usage.active_users,   limit: limits.users,      ...toLevel(usage.active_users,   limits.users) },
    workers: { used: usage.workers_count,  limit: limits.workers,    ...toLevel(usage.workers_count,  limits.workers) },
    api:     { used: usage.api_calls,      limit: null,              level: "unlimited" },
    storage: {
      used_gb: Number(usage.storage_bytes) / (1024 ** 3),
      limit_gb: limits.storage_gb,
      ...toLevel(Number(usage.storage_bytes) / (1024 ** 3), limits.storage_gb),
    },
  };
}
