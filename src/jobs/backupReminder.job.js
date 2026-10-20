/**
 * backupReminder.job.js — EPiC Platform
 *
 * runBackupReminder()    daily: nudges organisation admins (in-app + email) and
 *                        the superadmin when no recent backup exists. At most one
 *                        reminder per `reminderDays` window per scope, tracked in
 *                        platform_settings (`backup.org.<id>.last_reminded_at`,
 *                        `backup.platform.last_reminded_at`).
 * runBackupMaintenance() hourly: expired backup artefact cleanup + old
 *                        pre-restore database drop (implemented in backup.service.js).
 *
 * Env: BACKUP_REMINDER_CRON (see jobs/index.js), BACKUP_ALERT_EMAIL / EMAIL_USER.
 */

import { Op } from "sequelize";
import logger from "../utils/logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Pure helpers (exported for tests) ───────────────────────────────────────

/** Whole days between `from` and `now` (floor); null when `from` is missing. */
export function daysSince(from, now = new Date()) {
  if (!from) return null;
  const t = new Date(from).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

/**
 * Decide whether a reminder is due.
 * - stale: no backup ever, or last backup is >= reminderDays old
 * - deduped: a reminder was already sent less than reminderDays ago
 */
export function evaluateReminder({ lastBackupAt, lastRemindedAt, reminderDays, now = new Date() }) {
  const days = daysSince(lastBackupAt, now);
  const stale = days === null || days >= reminderDays;
  if (!stale) return { remind: false, reason: "recent_backup", daysSinceBackup: days };
  const sinceReminder = daysSince(lastRemindedAt, now);
  if (lastRemindedAt && sinceReminder !== null && now.getTime() - new Date(lastRemindedAt).getTime() < reminderDays * DAY_MS) {
    return { remind: false, reason: "already_reminded", daysSinceBackup: days };
  }
  return { remind: true, reason: days === null ? "no_backup" : "stale", daysSinceBackup: days };
}

/** Friendly "how long ago" phrase. */
export function describeAge(days) {
  if (days === null || days === undefined) return "no backup has been taken yet";
  if (days === 0) return "your last backup was taken today";
  return `your last backup was ${days} day${days === 1 ? "" : "s"} ago`;
}

export function buildOrgReminderMessage(days) {
  const age = days === null || days === undefined ? "No backup has been taken yet" : `It has been ${days} day${days === 1 ? "" : "s"} since your last backup`;
  return {
    title: "Time to back up your data",
    message: `${age}. You can take a fresh backup any time from Settings → Backup.`,
  };
}

export function buildPlatformReminderMessage(days) {
  const age = days === null || days === undefined ? "No platform backup has been taken yet" : `It has been ${days} day${days === 1 ? "" : "s"} since the last platform backup`;
  return {
    title: "Platform backup reminder",
    message: `${age}. You can take one from Superadmin → Backups.`,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function lastCompletedBackupAt(BackupJob, where) {
  const row = await BackupJob.findOne({
    where: { kind: "backup", status: "completed", ...where },
    order: [["completed_at", "DESC"]],
    attributes: ["id", "completed_at", "created_at"],
  });
  if (!row) return null;
  return row.completed_at || row.created_at || null;
}

function escHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ─── Job: reminder ───────────────────────────────────────────────────────────

export async function runBackupReminder() {
  const counts = { orgsChecked: 0, remindersSent: 0, errors: 0 };
  try {
    const settingsSvc = await import("../services/backupSettings.service.js");
    const globalSettings = await settingsSvc.getEffectiveBackupSettings(null);
    if (!globalSettings.reminderEnabled) {
      return { ...counts, skipped: "reminders_disabled" };
    }

    const platformDb = (await import("../models/index.js")).default;
    const { BackupJob, Organisation } = platformDb;
    if (!BackupJob) return { ...counts, skipped: "backup_jobs_model_unavailable" };

    const { getTenantDb } = await import("../services/tenantDb.service.js");
    const { notifyAdmins, NotificationTypes, NotificationPriority } = await import("../services/notification.service.js");
    const now = new Date();

    // ── Organisations ──
    const organisations = await Organisation.findAll({
      where: { status: { [Op.in]: ["active", "trial"] }, database_name: { [Op.not]: null } },
      attributes: ["id", "name", "database_name"],
    });

    for (const org of organisations) {
      counts.orgsChecked += 1;
      try {
        const eff = await settingsSvc.getEffectiveBackupSettings(org.id);
        if (!eff.orgDownloadEnabled) continue;

        const scopeKey = `org.${org.id}`;
        const lastBackupAt = await lastCompletedBackupAt(BackupJob, { scope: "organisation", organisation_id: org.id });
        const lastRemindedAt = await settingsSvc.getLastRemindedAt(scopeKey);
        const verdict = evaluateReminder({ lastBackupAt, lastRemindedAt, reminderDays: eff.reminderDays, now });
        if (!verdict.remind) continue;

        const { title, message } = buildOrgReminderMessage(verdict.daysSinceBackup);
        const tenantDb = getTenantDb(org.database_name);
        await notifyAdmins(tenantDb, {
          type: NotificationTypes.INFO,
          priority: NotificationPriority.MEDIUM,
          title,
          message,
          category: "system",
          entityType: "backup",
          organisationId: org.id,
          sendEmail: true,
          metadata: { daysSinceBackup: verdict.daysSinceBackup, reason: verdict.reason },
        });
        await settingsSvc.setLastRemindedAt(scopeKey, now);
        counts.remindersSent += 1;
      } catch (err) {
        counts.errors += 1;
        logger.error({ err, organisationId: org.id }, "[cron:backup-reminder] org reminder failed");
      }
    }

    // ── Platform (superadmin) ──
    try {
      const lastBackupAt = await lastCompletedBackupAt(BackupJob, { scope: { [Op.in]: ["platform", "all"] } });
      const lastRemindedAt = await settingsSvc.getLastRemindedAt("platform");
      const verdict = evaluateReminder({ lastBackupAt, lastRemindedAt, reminderDays: globalSettings.reminderDays, now });
      if (verdict.remind) {
        const { title, message } = buildPlatformReminderMessage(verdict.daysSinceBackup);
        const { createPlatformNotification } = await import("../services/platformActivity.service.js");
        await createPlatformNotification({
          title,
          message,
          type: "warning",
          category: "system",
          priority: "medium",
          entityType: "backup",
          metadata: { daysSinceBackup: verdict.daysSinceBackup, reason: verdict.reason },
        });

        const to = (process.env.BACKUP_ALERT_EMAIL || process.env.EMAIL_USER || "").trim();
        if (to) {
          try {
            const { sendTransactionalEmail } = await import("../services/mail.service.js");
            await sendTransactionalEmail({
              to,
              subject: `[EPiC] ${title}`,
              text: message,
              html: `<p>${escHtml(message)}</p>`,
              forcePlatformSmtp: true,
              notifyOwnerOnFailure: false,
              failureContext: "backup reminder",
            });
          } catch (mailErr) {
            logger.error({ err: mailErr }, "[cron:backup-reminder] platform reminder email failed");
          }
        }
        await settingsSvc.setLastRemindedAt("platform", now);
        counts.remindersSent += 1;
      }
    } catch (err) {
      counts.errors += 1;
      logger.error({ err }, "[cron:backup-reminder] platform reminder failed");
    }
  } catch (err) {
    counts.errors += 1;
    logger.error({ err }, "[cron:backup-reminder] failed");
  }
  return counts;
}

// ─── Job: maintenance ────────────────────────────────────────────────────────

export async function runBackupMaintenance() {
  const result = { expiredCleanup: null, preRestoreCleanup: null };
  let svc = null;
  try {
    svc = await import("../services/backup.service.js");
  } catch (err) {
    logger.warn({ err: err?.message }, "[cron:backup-maintenance] backup.service unavailable — skipping");
    return { ...result, skipped: "backup_service_unavailable" };
  }
  if (typeof svc.cleanupExpiredBackups === "function") {
    try {
      result.expiredCleanup = (await svc.cleanupExpiredBackups()) ?? null;
    } catch (err) {
      logger.error({ err }, "[cron:backup-maintenance] cleanupExpiredBackups failed");
      result.expiredCleanup = { error: err?.message || String(err) };
    }
  }
  if (typeof svc.dropOldPreRestoreDatabases === "function") {
    try {
      result.preRestoreCleanup = (await svc.dropOldPreRestoreDatabases()) ?? null;
    } catch (err) {
      logger.error({ err }, "[cron:backup-maintenance] dropOldPreRestoreDatabases failed");
      result.preRestoreCleanup = { error: err?.message || String(err) };
    }
  }
  return result;
}
