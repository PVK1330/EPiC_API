import platformDb from "../../../models/index.js";
import ApiResponse from "../../../utils/apiResponse.js";
import catchAsync from "../../../utils/catchAsync.js";
import { getEffectiveBackupSettings } from "../../../services/backupSettings.service.js";
import { createBackupJob, findActiveJob, serializeJobs, DB_NAME_RE } from "../../../services/backup.service.js";
import {
  UUID_RE,
  auditReq,
  deleteBackupJob,
  handleRestoreRequest,
  lastActivityByOrg,
  parsePaging,
  streamBackupDownload,
} from "../../Shared/Backups/backup.common.js";

// Every query is scoped to req.user.organisation_id; no organisation id is ever read from the client.
const orgIdOf = (req) => Number(req.user.organisation_id);

async function loadOwnJob(req, res) {
  if (!UUID_RE.test(req.params.id)) {
    ApiResponse.notFound(res, "Backup not found");
    return null;
  }
  const job = await platformDb.BackupJob.findOne({
    where: { id: req.params.id, organisation_id: orgIdOf(req), scope: "organisation" },
  });
  if (!job) {
    ApiResponse.notFound(res, "Backup not found");
    return null;
  }
  return job;
}

export const requireDownloadEnabled = catchAsync(async (req, res, next) => {
  const s = await getEffectiveBackupSettings(orgIdOf(req));
  if (!s.orgDownloadEnabled) return ApiResponse.forbidden(res, "Backups are disabled for your organisation");
  return next();
});

export const requireRestoreEnabled = catchAsync(async (req, res, next) => {
  const s = await getEffectiveBackupSettings(orgIdOf(req));
  if (!s.orgRestoreEnabled) return ApiResponse.forbidden(res, "Restore is disabled for your organisation");
  return next();
});

export const getStatus = catchAsync(async (req, res) => {
  const orgId = orgIdOf(req);
  const [s, last] = await Promise.all([getEffectiveBackupSettings(orgId), lastActivityByOrg([orgId])]);
  const l = last.get(orgId) || {};
  const days = l.backup ? Math.floor((Date.now() - new Date(l.backup).getTime()) / 86400000) : null;
  return ApiResponse.success(res, "Backup status retrieved", {
    last_backup_at: l.backup || null,
    last_restore_at: l.restore || null,
    days_since_last_backup: days,
    reminder_days: s.reminderDays,
    download_enabled: s.orgDownloadEnabled,
    restore_enabled: s.orgRestoreEnabled,
    retention_hours: s.retentionHours,
    max_upload_mb: s.maxUploadMb,
  });
});

export const listJobs = catchAsync(async (req, res) => {
  const { page, limit, offset } = parsePaging(req.query);
  const { rows, count } = await platformDb.BackupJob.findAndCountAll({
    where: { organisation_id: orgIdOf(req), scope: "organisation" },
    order: [["created_at", "DESC"]],
    limit,
    offset,
  });
  return ApiResponse.success(res, "Backups retrieved", { items: await serializeJobs(rows), total: count, page, limit });
});

export const createJob = catchAsync(async (req, res) => {
  const org = await platformDb.Organisation.findByPk(orgIdOf(req), { attributes: ["id", "name", "slug", "database_name"] });
  if (!org || !org.database_name || !DB_NAME_RE.test(org.database_name)) {
    return ApiResponse.notFound(res, "Organisation not found");
  }
  if (await findActiveJob("organisation", org.id, "backup")) {
    return ApiResponse.error(res, "A backup is already in progress", 409);
  }
  const job = await createBackupJob({
    scope: "organisation",
    organisation: org,
    requestedBy: req.user.id,
    requestedByRole: req.user.role_id ?? null,
  });
  auditReq(req, "Backup Requested", `organisation backup queued (job ${job.id})`, { orgId: org.id, orgLabel: org.name });
  return ApiResponse.success(res, "Backup started", { job: await serializeJobs(job) }, 202);
});

export const getJob = catchAsync(async (req, res) => {
  const job = await loadOwnJob(req, res);
  if (!job) return;
  return ApiResponse.success(res, "Backup retrieved", { job: await serializeJobs(job) });
});

export const downloadJob = catchAsync(async (req, res) => {
  const job = await loadOwnJob(req, res);
  if (!job) return;
  return streamBackupDownload(req, res, job, { password: req.body?.password, totp: req.body?.totp });
});

export const removeJob = catchAsync(async (req, res) => {
  const job = await loadOwnJob(req, res);
  if (!job) return;
  return deleteBackupJob(req, res, job);
});

export const restore = catchAsync(async (req, res) =>
  handleRestoreRequest(req, res, { organisationId: orgIdOf(req), allowPlatform: false }),
);
