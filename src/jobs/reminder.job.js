/**
 * reminder.job.js — EPiC Platform
 *
 * Detects compliance items (Right-to-Work, Worker Events, Sponsor Change
 * Requests) that are in "Information Requested" status and have received NO
 * sponsor response for 3+ working days.  Sends an email chaser to the
 * sponsor admin and logs the reminder in the audit trail.
 *
 * Registered in src/jobs/index.js as "information-requested-reminders"
 * (10:00 IST daily).
 *
 * Working-day definition: Monday–Friday; Saturday and Sunday are skipped.
 * UK bank holidays are NOT excluded here (a lightweight conservative approach —
 * add a bank-holiday lookup if the product needs it later).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * How it works
 * ────────────────────────────────────────────────────────────────────────────
 *  1. For every active/trial organisation, obtain the tenant DB.
 *  2. Query each of the three compliance entity tables for rows where:
 *       reviewStatus = 'Information Requested'
 *       reviewedAt   ≤ (today − 3 working days)
 *  3. For each stale record:
 *       a. Send an email chaser to the sponsor (via sponsorId → User.email).
 *       b. Notify admins in-app + email.
 *       c. Write an audit log row so the reminder is traceable.
 *  4. Returns aggregate counts for the cron runner's structured log.
 */

import { Op } from "sequelize";
import platformDb from "../models/index.js";
import { getTenantDb } from "../services/tenantDb.service.js";
import {
  notifyUser,
  notifyAdmins,
  NotificationTypes,
  NotificationPriority,
} from "../services/notification.service.js";
import { recordAuditLog } from "../services/audit.service.js";
import { sendTransactionalEmail } from "../services/mail.service.js";
import { sendWhatsAppReminder } from "../services/whatsappReminder.service.js";
import logger from "../utils/logger.js";

// ─── Working-day helpers ──────────────────────────────────────────────────────

/**
 * Returns true when `date` falls on a weekday (Mon–Fri).
 */
function isWorkingDay(date) {
  const day = date.getDay(); // 0 = Sun, 6 = Sat
  return day !== 0 && day !== 6;
}

/**
 * Subtract `n` working days from `fromDate` and return the resulting Date.
 * Iterates backwards, counting only Mon–Fri.
 *
 * @param {Date}   fromDate  - Reference point (usually today at midnight).
 * @param {number} n         - Number of working days to subtract (must be > 0).
 * @returns {Date}
 */
export function subtractWorkingDays(fromDate, n) {
  const d = new Date(fromDate);
  d.setHours(0, 0, 0, 0);
  let remaining = n;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    if (isWorkingDay(d)) remaining -= 1;
  }
  return d;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const INFORMATION_REQUESTED = "Information Requested";
const WORKING_DAY_THRESHOLD  = 3;

/**
 * The three compliance entity types to check.
 * Each entry maps to the tenantDb model key, a human label, and the
 * entityType string used in audit / notification history.
 */
const COMPLIANCE_ENTITIES = [
  { model: "RightToWorkRecord",  label: "Right-to-Work check",    entityType: "right_to_work"    },
  { model: "WorkerEvent",        label: "Worker event",            entityType: "worker_event"     },
  { model: "SponsorChangeRequest", label: "Sponsor change request", entityType: "change_request"  },
];

// ─── Per-record reminder logic ────────────────────────────────────────────────

/**
 * Send all reminder channels (email, in-app, WhatsApp stub, audit) for a
 * single stale "Information Requested" record.
 *
 * @param {object} tenantDb
 * @param {object} record         - Sequelize model instance.
 * @param {object} entityCfg      - One entry from COMPLIANCE_ENTITIES.
 * @param {number} organisationId
 */
async function sendReminderForRecord(tenantDb, record, entityCfg, organisationId) {
  const { label, entityType } = entityCfg;

  // ── Resolve sponsor details ──────────────────────────────────────────────
  let sponsorEmail = null;
  let sponsorName  = "Sponsor";
  let sponsorPhone = null;

  if (record.sponsorId) {
    try {
      const sponsor = await tenantDb.User.findByPk(record.sponsorId, {
        attributes: ["id", "first_name", "last_name", "email", "phone"],
      });
      if (sponsor) {
        sponsorEmail = sponsor.email || null;
        sponsorName  = [sponsor.first_name, sponsor.last_name].filter(Boolean).join(" ") || "Sponsor";
        sponsorPhone = sponsor.phone || null;
      }
    } catch (err) {
      logger.warn({ err, sponsorId: record.sponsorId }, "[reminder] Could not resolve sponsor user");
    }
  }

  const subject = `Action required: ${label} (#${record.id}) — please respond`;
  const bodyText =
    `Dear ${sponsorName},\n\n` +
    `We are following up on your ${label.toLowerCase()} (#${record.id}) that is ` +
    `currently awaiting your response. Our team has requested additional information ` +
    `more than ${WORKING_DAY_THRESHOLD} working days ago.\n\n` +
    `Please log in to the EPiC portal and provide the requested information as soon ` +
    `as possible to avoid delays in processing your case.\n\n` +
    `If you have any questions, please contact your caseworker directly.\n\n` +
    `EPiC Compliance Team`;

  const bodyHtml =
    `<p>Dear ${sponsorName},</p>` +
    `<p>We are following up on your <strong>${label}</strong> (#${record.id}) that is ` +
    `currently awaiting your response.</p>` +
    `<p>Our team requested additional information <strong>more than ` +
    `${WORKING_DAY_THRESHOLD} working days ago</strong>. Please log in to the EPiC ` +
    `portal and provide the requested information at your earliest convenience to avoid ` +
    `delays in processing.</p>` +
    `<p>If you have any questions, please contact your caseworker directly.</p>` +
    `<p>Regards,<br/>EPiC Compliance Team</p>`;

  // ── 1. Email chaser to sponsor ───────────────────────────────────────────
  if (sponsorEmail) {
    try {
      await sendTransactionalEmail({
        to: sponsorEmail,
        subject,
        html: bodyHtml,
        text: bodyText,
        organisationId,
        failureContext: `3-working-day information-requested chaser for ${entityType} #${record.id}`,
      });
      logger.info(
        { entityType, entityId: record.id, sponsorEmail },
        "[reminder] Chaser email sent to sponsor",
      );
    } catch (err) {
      logger.error({ err, entityType, entityId: record.id }, "[reminder] Failed to email sponsor");
    }
  } else {
    logger.warn(
      { entityType, entityId: record.id, sponsorId: record.sponsorId },
      "[reminder] Sponsor has no email address — skipping email chaser",
    );
  }

  // ── 2. WhatsApp stub (non-blocking) ─────────────────────────────────────
  if (sponsorPhone) {
    const waMessage =
      `EPiC reminder: Your ${label} (#${record.id}) needs your response. ` +
      `It has been over ${WORKING_DAY_THRESHOLD} working days. Please log in to the EPiC portal.`;
    try {
      const waResult = await sendWhatsAppReminder(sponsorPhone, waMessage);
      if (!waResult.sent) {
        logger.info(
          { entityType, entityId: record.id, reason: waResult.reason },
          "[reminder] WhatsApp not sent",
        );
      }
    } catch (err) {
      // WhatsApp is best-effort; never block the reminder pipeline.
      logger.warn({ err, entityType, entityId: record.id }, "[reminder] WhatsApp stub error");
    }
  }

  // ── 3. In-app notification to sponsor ───────────────────────────────────
  if (record.sponsorId) {
    try {
      await notifyUser(tenantDb, record.sponsorId, {
        type: NotificationTypes.WARNING,
        priority: NotificationPriority.HIGH,
        title: `Action required: ${label}`,
        message:
          `Your ${label.toLowerCase()} (#${record.id}) has been awaiting your response ` +
          `for more than ${WORKING_DAY_THRESHOLD} working days. Please provide the ` +
          `requested information as soon as possible.`,
        category: "compliance",
        entityType,
        entityId: record.id,
        actionType: "information_requested_chaser",
        sendEmail: false, // already sent above via sendTransactionalEmail
        organisationId,
      });
    } catch (err) {
      logger.error({ err, entityType, entityId: record.id }, "[reminder] Failed in-app notify to sponsor");
    }
  }

  // ── 4. In-app notification to admins ────────────────────────────────────
  try {
    await notifyAdmins(tenantDb, {
      type: NotificationTypes.WARNING,
      priority: NotificationPriority.HIGH,
      title: `Sponsor not responding: ${label}`,
      message:
        `${label} (#${record.id}) has been in "Information Requested" status for more ` +
        `than ${WORKING_DAY_THRESHOLD} working days with no sponsor response. ` +
        `An email chaser has been sent to ${sponsorName}${sponsorEmail ? ` (${sponsorEmail})` : ""}.`,
      actionType: "information_requested_chaser",
      entityId: record.id,
      entityType,
      metadata: {
        entityId: record.id,
        entityType,
        sponsorId: record.sponsorId,
        reviewedAt: record.reviewedAt,
      },
      organisationId,
      sendEmail: true,
    });
  } catch (err) {
    logger.error({ err, entityType, entityId: record.id }, "[reminder] Failed admin notification");
  }

  // ── 5. Audit log ─────────────────────────────────────────────────────────
  try {
    await recordAuditLog({
      tenantDb,
      userId: null,   // system-initiated
      action: `COMPLIANCE_${entityType.toUpperCase()}_INFORMATION_REQUESTED_CHASER`,
      resource: entityType,
      status: "Success",
      details: JSON.stringify({
        entityId: record.id,
        reviewedAt: record.reviewedAt,
        workingDayThreshold: WORKING_DAY_THRESHOLD,
        sponsorId: record.sponsorId,
        emailSent: Boolean(sponsorEmail),
      }),
      req: null,
      organisationId,
    });
  } catch (err) {
    logger.error({ err, entityType, entityId: record.id }, "[reminder] Failed to write audit log");
  }
}

// ─── Per-entity scan ──────────────────────────────────────────────────────────

/**
 * Query one compliance entity table and send reminders for stale records.
 *
 * @param {object} tenantDb
 * @param {object} entityCfg       - Entry from COMPLIANCE_ENTITIES.
 * @param {Date}   cutoffDate      - Records with reviewedAt <= this date are stale.
 * @param {number} organisationId
 * @returns {Promise<number>}      - Number of reminders sent.
 */
async function checkEntityForStalledRecords(tenantDb, entityCfg, cutoffDate, organisationId) {
  const Model = tenantDb[entityCfg.model];
  if (!Model) {
    logger.warn({ model: entityCfg.model }, "[reminder] Model not found in tenant DB — skipping");
    return 0;
  }

  const stalledRecords = await Model.findAll({
    where: {
      reviewStatus: INFORMATION_REQUESTED,
      reviewedAt: { [Op.lte]: cutoffDate },
    },
    attributes: ["id", "sponsorId", "reviewStatus", "reviewedAt"],
  });

  let count = 0;
  for (const record of stalledRecords) {
    try {
      await sendReminderForRecord(tenantDb, record, entityCfg, organisationId);
      count += 1;
    } catch (err) {
      logger.error(
        { err, entityType: entityCfg.entityType, entityId: record.id },
        "[reminder] Unexpected error processing record",
      );
    }
  }

  return count;
}

// ─── Per-tenant check ─────────────────────────────────────────────────────────

async function runTenantReminderChecks(tenantDb, organisationId, cutoffDate) {
  let totalReminders = 0;

  for (const entityCfg of COMPLIANCE_ENTITIES) {
    try {
      const count = await checkEntityForStalledRecords(
        tenantDb,
        entityCfg,
        cutoffDate,
        organisationId,
      );
      totalReminders += count;
    } catch (err) {
      logger.error(
        { err, model: entityCfg.model, organisationId },
        "[reminder] Entity check failed",
      );
    }
  }

  return totalReminders;
}

// ─── Public export ────────────────────────────────────────────────────────────

/**
 * Main entry point — called by the cron runner in index.js.
 *
 * Iterates all active/trial organisations, finds "Information Requested"
 * compliance records stalled for 3+ working days, and sends chaser
 * notifications + audit entries.
 *
 * @returns {Promise<{ remindersSent: number, organisationsProcessed: number }>}
 */
export async function runInformationRequestedReminders() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // The cutoff: records where the reviewer set "Information Requested" 3+
  // working days ago with no sponsor response (i.e. reviewedAt <= cutoff).
  const cutoffDate = subtractWorkingDays(today, WORKING_DAY_THRESHOLD);

  logger.info(
    { cutoffDate, workingDayThreshold: WORKING_DAY_THRESHOLD },
    "[reminder] Starting information-requested chaser check",
  );

  let remindersSent           = 0;
  let organisationsProcessed  = 0;

  try {
    const organisations = await platformDb.Organisation.findAll({
      where: {
        status: { [Op.in]: ["active", "trial"] },
        database_name: { [Op.not]: null },
      },
      attributes: ["id", "name", "database_name"],
    });

    for (const org of organisations) {
      try {
        const tenantDb = getTenantDb(org.database_name);
        const count    = await runTenantReminderChecks(tenantDb, org.id, cutoffDate);
        remindersSent          += count;
        organisationsProcessed += 1;

        if (count > 0) {
          logger.info(
            { organisationId: org.id, orgName: org.name, remindersSent: count },
            "[reminder] Chaser reminders sent for org",
          );
        }
      } catch (err) {
        logger.error(
          { err, organisationId: org.id },
          "[reminder] Failed processing org",
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "[reminder] Fatal error in runInformationRequestedReminders");
    throw err;
  }

  logger.info(
    { remindersSent, organisationsProcessed, cutoffDate },
    "[reminder] Information-requested chaser check complete",
  );

  return { remindersSent, organisationsProcessed };
}
