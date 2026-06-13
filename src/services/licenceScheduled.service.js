/**
 * Licence Scheduled Service
 *
 * Contains all scheduled business logic for the sponsor licence module:
 *   1. Licence Expiry Reminders  — 90 / 60 / 30 / 14 days before expiry
 *   2. SLA Breach Detector       — applications stalled > 5 / 10 / 15 days
 *   3. processScheduledNotifications() — master runner called by cron
 *
 * Multi-tenant: iterates every active organisation via platformDb → getTenantDb().
 * Error isolation: one failing tenant never blocks the rest.
 * Dedup:
 *   - Expiry reminders: exact-day match (expiryDate === today + N days) fires once per
 *     threshold per application lifetime — no additional dedup required.
 *   - SLA breach:  exact-day match on each threshold (5 / 10 / 15 days since last update)
 *     so each escalation fires once per breach level — no audit-log dedup required.
 */

import { Op } from "sequelize";
import platformDb from "../models/index.js";
import { getTenantDb } from "./tenantDb.service.js";
import { deliver } from "./sponsorshipNotification.service.js";
import {
  notifyAdmins,
  NotificationTypes,
  NotificationPriority,
} from "./notification.service.js";
import { recordAuditLog } from "./audit.service.js";
import { extractCaseworkerIds } from "./licenceAssignment.service.js";
import logger from "../utils/logger.js";

// ── Constants ──────────────────────────────────────────────────────────────────

/** Days before licence expiry at which reminders fire. */
const EXPIRY_ALERT_DAYS = [90, 60, 30, 14];

/**
 * Standard UKVI initial sponsor licence term (4 years).
 * Used to derive expiry date from proposedStartDate.
 */
const LICENCE_TERM_DAYS = 1460;

/**
 * SLA escalation levels: days since last status update that trigger a breach alert.
 * Each threshold fires exactly once (using exact-day matching).
 */
const SLA_THRESHOLDS = [5, 10, 15];

/** Application statuses that should be actively progressing. */
const ACTIVE_STATUSES = [
  "Pending",
  "Under Review",
  "Information Requested",
  "Government Processing",
];

// ── Date helpers ───────────────────────────────────────────────────────────────

const addDays = (date, n) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
};

const toDateStr = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * Derive licence expiry date.
 * Uses proposedStartDate if set, otherwise falls back to updatedAt (approximate
 * — the date the application was last touched, e.g., when status flipped to Approved).
 */
const deriveExpiryDate = (app) => {
  const base = app.proposedStartDate || app.updatedAt;
  return base ? addDays(new Date(base), LICENCE_TERM_DAYS) : null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// 1. LICENCE EXPIRY REMINDERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Send expiry reminder for a single application at `daysLeft` days before expiry.
 * Recipients: sponsor (userId) · assigned caseworkers · admins.
 * At 30 days: email is forced for all recipients (critical milestone).
 */
async function sendExpiryReminder(tenantDb, orgId, app, daysLeft) {
  const expiryDate = deriveExpiryDate(app);
  const expiryStr = expiryDate ? toDateStr(expiryDate) : "soon";
  const isCritical = daysLeft <= 30;

  const priority = daysLeft <= 14
    ? NotificationPriority.URGENT
    : isCritical
      ? NotificationPriority.HIGH
      : NotificationPriority.MEDIUM;

  const sponsorTitle = `Sponsor Licence Expiry — ${daysLeft} Days Remaining`;
  const sponsorMsg = isCritical
    ? `Your sponsor licence for ${app.companyName} expires on ${expiryStr}. Immediate action required — submit your renewal application now to avoid a lapse in sponsorship rights.`
    : `Your sponsor licence for ${app.companyName} expires on ${expiryStr}. Please begin preparing your renewal application.`;

  // ── Sponsor ──────────────────────────────────────────────────────────────────
  try {
    await deliver({
      tenantDb,
      recipientUserId: app.userId,
      type: isCritical ? NotificationTypes.WARNING : NotificationTypes.INFO,
      priority,
      title: sponsorTitle,
      message: sponsorMsg,
      entityType: "licence_application",
      entityId: app.id,
      actionType: "licence_expiry_reminder",
      actionUrl: "/business/licence-process",
      emailSubject: `${daysLeft <= 14 ? "URGENT: " : ""}Sponsor Licence Expires in ${daysLeft} Days`,
      email: true,
      inApp: true,
      audit: {
        actorId: null,
        action: `LICENCE_EXPIRY_REMINDER_${daysLeft}D`,
        resource: "licence_application",
        details: { applicationId: app.id, company: app.companyName, daysLeft, expiryDate: expiryStr },
      },
      organisationId: orgId,
    });
  } catch (err) {
    logger.warn({ err, applicationId: app.id, daysLeft }, "licenceExpiry: sponsor notify failed");
  }

  // ── Caseworkers ──────────────────────────────────────────────────────────────
  const cwIds = extractCaseworkerIds(app.assignedcaseworkerId);
  for (const cwId of cwIds) {
    try {
      await deliver({
        tenantDb,
        recipientUserId: cwId,
        type: isCritical ? NotificationTypes.WARNING : NotificationTypes.INFO,
        priority,
        title: `Licence Expiry — ${daysLeft}d: ${app.companyName}`,
        message: `Sponsor licence for ${app.companyName} (application #${app.id}) expires on ${expiryStr}. ${isCritical ? "Please initiate or chase the renewal application urgently." : "Begin renewal preparation."}`,
        entityType: "licence_application",
        entityId: app.id,
        actionType: "licence_expiry_reminder",
        actionUrl: "/caseworker/licence-reviews",
        inApp: true,
        email: isCritical, // email caseworkers only at 30d and 14d
        organisationId: orgId,
      });
    } catch (err) {
      logger.warn({ err, cwId, applicationId: app.id }, "licenceExpiry: caseworker notify failed");
    }
  }

  // ── Admins ───────────────────────────────────────────────────────────────────
  try {
    await notifyAdmins(tenantDb, {
      type: isCritical ? NotificationTypes.WARNING : NotificationTypes.INFO,
      priority,
      title: `Licence Expiry Alert — ${daysLeft}d: ${app.companyName}`,
      message: `${app.companyName} sponsor licence expires on ${expiryStr} (${daysLeft} days). ${isCritical ? "Renewal urgently required." : "Monitor renewal progress."}`,
      actionType: "licence_expiry_reminder",
      entityId: app.id,
      entityType: "licence_application",
      metadata: { daysLeft, expiryDate: expiryStr, applicationId: app.id },
      organisationId: orgId,
      sendEmail: isCritical, // email admins at 30d and 14d only
    });
  } catch (err) {
    logger.warn({ err, applicationId: app.id }, "licenceExpiry: admin notify failed");
  }
}

/**
 * Check expiry milestones for all approved applications in one tenant DB.
 * For each threshold T, looks for applications whose derived expiry date is
 * exactly T days from today. This fires each alert exactly once per app lifecycle.
 */
async function checkLicenceExpiryForTenant(tenantDb, orgId, today) {
  // Fetch all approved applications with a base date to derive expiry from.
  const approved = await tenantDb.LicenceApplication.findAll({
    where: {
      status: "Approved",
      [Op.or]: [
        { proposedStartDate: { [Op.not]: null } },
        { updatedAt: { [Op.not]: null } },
      ],
    },
    attributes: [
      "id", "userId", "companyName", "assignedcaseworkerId",
      "proposedStartDate", "updatedAt",
    ],
  });

  const todayStr = toDateStr(today);
  let remindersSent = 0;

  for (const app of approved) {
    const expiryDate = deriveExpiryDate(app);
    if (!expiryDate) continue;

    for (const daysLeft of EXPIRY_ALERT_DAYS) {
      const targetStr = toDateStr(addDays(today, daysLeft));
      if (toDateStr(expiryDate) !== targetStr) continue;

      // Expiry is exactly `daysLeft` days from today → fire the reminder.
      try {
        await sendExpiryReminder(tenantDb, orgId, app, daysLeft);
        remindersSent += 1;
        logger.info(
          { applicationId: app.id, daysLeft, company: app.companyName, expiryDate: toDateStr(expiryDate) },
          "Licence expiry reminder sent",
        );
      } catch (err) {
        logger.error({ err, applicationId: app.id, daysLeft }, "licenceExpiry: sendExpiryReminder failed");
      }
    }
  }

  return remindersSent;
}

/**
 * Run licence expiry reminders across all active organisations.
 * Entry point called by the scheduler.
 */
export async function runLicenceExpiryReminders() {
  const label = "runLicenceExpiryReminders";
  logger.info(`${label}: starting`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const orgs = await platformDb.Organisation.findAll({
      where: {
        status: { [Op.in]: ["active", "trial"] },
        database_name: { [Op.not]: null },
      },
      attributes: ["id", "name", "database_name"],
    });

    let total = 0;
    for (const org of orgs) {
      try {
        const tenantDb = getTenantDb(org.database_name);
        const count = await checkLicenceExpiryForTenant(tenantDb, org.id, today);
        total += count;
      } catch (err) {
        logger.error({ err, orgId: org.id }, `${label}: tenant check failed`);
      }
    }

    logger.info({ orgsProcessed: orgs.length, remindersSent: total }, `${label}: completed`);
    return { orgsProcessed: orgs.length, remindersSent: total };
  } catch (err) {
    logger.error({ err }, `${label}: fatal error`);
    return { orgsProcessed: 0, remindersSent: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SLA BREACH DETECTOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Send an SLA breach alert for a single application.
 * Recipients: assigned caseworkers + admins.
 * Severity escalates with each threshold: 5d → WARNING, 10d → WARNING+email, 15d → high priority.
 */
async function sendSlaBreachAlert(tenantDb, orgId, app, daysSinceUpdate, threshold) {
  const isEscalated = threshold >= 10;
  const isHighEscalation = threshold >= 15;

  const title = `SLA Breach (${daysSinceUpdate}d): ${app.companyName}`;
  const message =
    `Licence application #${app.id} for ${app.companyName} has had no progress for ` +
    `${daysSinceUpdate} days (status: ${app.status}). ` +
    (isHighEscalation ? "ESCALATED — immediate supervisor review required." : "Immediate caseworker action required.");

  // ── Admins ───────────────────────────────────────────────────────────────────
  try {
    await notifyAdmins(tenantDb, {
      type: NotificationTypes.WARNING,
      priority: isHighEscalation ? NotificationPriority.URGENT : NotificationPriority.HIGH,
      title,
      message,
      actionType: "licence_sla_breach",
      entityId: app.id,
      entityType: "licence_application",
      metadata: { applicationId: app.id, status: app.status, daysSinceUpdate, threshold },
      organisationId: orgId,
      sendEmail: isEscalated, // email admins at 10d+ only to reduce noise
    });
  } catch (err) {
    logger.warn({ err, applicationId: app.id }, "licenceSla: admin notify failed");
  }

  // ── Caseworkers ──────────────────────────────────────────────────────────────
  const cwIds = extractCaseworkerIds(app.assignedcaseworkerId);
  for (const cwId of cwIds) {
    try {
      await deliver({
        tenantDb,
        recipientUserId: cwId,
        type: NotificationTypes.WARNING,
        priority: isHighEscalation ? NotificationPriority.URGENT : NotificationPriority.HIGH,
        title,
        message: `Licence application #${app.id} for ${app.companyName} has stalled for ${daysSinceUpdate} days (status: ${app.status}). Please take action immediately.`,
        entityType: "licence_application",
        entityId: app.id,
        actionType: "licence_sla_breach",
        actionUrl: "/caseworker/licence-reviews",
        inApp: true,
        email: isEscalated,
        organisationId: orgId,
      });
    } catch (err) {
      logger.warn({ err, cwId, applicationId: app.id }, "licenceSla: caseworker notify failed");
    }
  }

  // ── Audit ────────────────────────────────────────────────────────────────────
  try {
    await recordAuditLog({
      tenantDb,
      userId: null,
      action: `LICENCE_SLA_BREACH_${threshold}D`,
      resource: "licence_application",
      status: "Success",
      details: JSON.stringify({
        applicationId: app.id,
        company: app.companyName,
        status: app.status,
        daysSinceUpdate,
        threshold,
      }),
      organisationId: orgId,
    });
  } catch (err) {
    logger.warn({ err, applicationId: app.id }, "licenceSla: audit log failed");
  }
}

/**
 * Check SLA breaches for all active applications in one tenant.
 *
 * For each SLA threshold T (5 / 10 / 15 days), we look for applications whose
 * `updatedAt` falls in the range [today - (T+1) days, today - T days).
 * This exact-day approach means each threshold fires once per application —
 * no audit-log dedup required.
 */
async function checkSlaBreachesForTenant(tenantDb, orgId, today) {
  let breachCount = 0;

  for (const threshold of SLA_THRESHOLDS) {
    // Exact 24-hour window: updatedAt falls in [T+1 days ago, T days ago)
    const windowEnd   = addDays(today, -threshold);        // start of T-days-ago
    const windowStart = addDays(today, -(threshold + 1));  // start of (T+1)-days-ago

    let stuckApps;
    try {
      stuckApps = await tenantDb.LicenceApplication.findAll({
        where: {
          status: { [Op.in]: ACTIVE_STATUSES },
          updatedAt: { [Op.gte]: windowStart, [Op.lt]: windowEnd },
        },
        attributes: [
          "id", "userId", "companyName", "status", "assignedcaseworkerId", "updatedAt",
        ],
      });
    } catch (err) {
      logger.error({ err, orgId, threshold }, "licenceSla: query failed");
      continue;
    }

    for (const app of stuckApps) {
      const daysSinceUpdate = threshold; // exact match → daysSinceUpdate === threshold
      try {
        await sendSlaBreachAlert(tenantDb, orgId, app, daysSinceUpdate, threshold);
        breachCount += 1;
        logger.warn(
          { applicationId: app.id, company: app.companyName, status: app.status, daysSinceUpdate },
          "Licence SLA breach detected and notified",
        );
      } catch (err) {
        logger.error({ err, applicationId: app.id, threshold }, "licenceSla: sendSlaBreachAlert failed");
      }
    }
  }

  return breachCount;
}

/**
 * Run SLA breach detection across all active organisations.
 */
export async function runLicenceSlaBreachDetector() {
  const label = "runLicenceSlaBreachDetector";
  logger.info(`${label}: starting`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const orgs = await platformDb.Organisation.findAll({
      where: {
        status: { [Op.in]: ["active", "trial"] },
        database_name: { [Op.not]: null },
      },
      attributes: ["id", "name", "database_name"],
    });

    let total = 0;
    for (const org of orgs) {
      try {
        const tenantDb = getTenantDb(org.database_name);
        const count = await checkSlaBreachesForTenant(tenantDb, org.id, today);
        total += count;
      } catch (err) {
        logger.error({ err, orgId: org.id }, `${label}: tenant check failed`);
      }
    }

    logger.info({ orgsProcessed: orgs.length, breachesDetected: total }, `${label}: completed`);
    return { orgsProcessed: orgs.length, breachesDetected: total };
  } catch (err) {
    logger.error({ err }, `${label}: fatal error`);
    return { orgsProcessed: 0, breachesDetected: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. MASTER RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * processScheduledNotifications()
 *
 * Master orchestrator for all licence-module scheduled notifications.
 * Called by the daily cron job (08:00 IST) and also safe to call manually
 * (e.g., via an admin API endpoint or test script).
 *
 * Jobs run in parallel via Promise.allSettled — a failure in one job
 * does not prevent the other from completing.
 *
 * @returns {{ durationMs, expiryReminders, slaBreaches }} Summary object.
 */
export async function processScheduledNotifications() {
  const label = "processScheduledNotifications";
  logger.info(`${label}: starting`);
  const t0 = Date.now();

  const [expiryResult, slaResult] = await Promise.allSettled([
    runLicenceExpiryReminders(),
    runLicenceSlaBreachDetector(),
  ]);

  const summary = {
    durationMs:      Date.now() - t0,
    expiryReminders: expiryResult.status === "fulfilled"
      ? expiryResult.value
      : { error: String(expiryResult.reason?.message ?? expiryResult.reason) },
    slaBreaches:     slaResult.status === "fulfilled"
      ? slaResult.value
      : { error: String(slaResult.reason?.message ?? slaResult.reason) },
  };

  logger.info(summary, `${label}: completed`);
  return summary;
}
