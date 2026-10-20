import { Op } from "sequelize";
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

const KINDS = ["backup", "restore"];
const STATUSES = ["pending", "running", "completed", "failed", "expired"];

/** Non-organisation scopes (platform / all) are superadmin-only. */
async function loadJob(req, res) {
  if (!UUID_RE.test(req.params.id)) {
    ApiResponse.notFound(res, "Backup not found");
    return null;
  }
  const job = await platformDb.BackupJob.findByPk(req.params.id);
  if (!job || (job.scope !== "organisation" && !req.isPlatformSuperAdmin)) {
    ApiResponse.notFound(res, "Backup not found");
    return null;
  }
  return job;
}

export const listJobs = catchAsync(async (req, res) => {
  const { page, limit, offset } = parsePaging(req.query);
  const where = {};
  if (req.query.organisation_id) {
    const id = parseInt(req.query.organisation_id, 10);
    if (!Number.isInteger(id)) return ApiResponse.badRequest(res, "Invalid organisation_id");
    where.organisation_id = id;
  }
  if (req.query.kind) {
    if (!KINDS.includes(req.query.kind)) return ApiResponse.badRequest(res, "Invalid kind");
    where.kind = req.query.kind;
  }
  if (req.query.status) {
    if (!STATUSES.includes(req.query.status)) return ApiResponse.badRequest(res, "Invalid status");
    where.status = req.query.status;
  }
  if (!req.isPlatformSuperAdmin) where.scope = "organisation";
  const { rows, count } = await platformDb.BackupJob.findAndCountAll({
    where,
    order: [["created_at", "DESC"]],
    limit,
    offset,
  });
  return ApiResponse.success(res, "Backups retrieved", { items: await serializeJobs(rows), total: count, page, limit });
});

export const listOrganisations = catchAsync(async (req, res) => {
  const orgs = await platformDb.Organisation.findAll({
    where: { database_name: { [Op.ne]: null } },
    attributes: ["id", "name", "database_name", "status"],
    order: [["name", "ASC"]],
  });
  const last = await lastActivityByOrg(orgs.map((o) => o.id));
  const data = await Promise.all(
    orgs.map(async (o) => {
      const s = await getEffectiveBackupSettings(o.id);
      const l = last.get(o.id) || {};
      return {
        id: o.id,
        name: o.name,
        database_name: o.database_name,
        status: o.status,
        last_backup_at: l.backup || null,
        last_restore_at: l.restore || null,
        download_enabled: s.orgDownloadEnabled,
        restore_enabled: s.orgRestoreEnabled,
        reminder_days: s.reminderDays,
      };
    }),
  );
  return ApiResponse.success(res, "Organisations retrieved", data);
});

export const createJob = catchAsync(async (req, res) => {
  const { scope, organisation_id: rawOrg } = req.body || {};
  if (!["organisation", "platform", "all"].includes(scope)) {
    return ApiResponse.badRequest(res, "scope must be organisation, platform or all");
  }
  let org = null;
  if (scope === "organisation") {
    const id = parseInt(rawOrg, 10);
    if (!Number.isInteger(id)) return ApiResponse.badRequest(res, "organisation_id is required");
    org = await platformDb.Organisation.findByPk(id, { attributes: ["id", "name", "slug", "database_name"] });
    if (!org || !org.database_name || !DB_NAME_RE.test(org.database_name)) {
      return ApiResponse.notFound(res, "Organisation not found or has no database");
    }
  } else if (!req.isPlatformSuperAdmin) {
    return ApiResponse.forbidden(res, "Only a superadmin can back up the platform or all databases");
  }
  if (await findActiveJob(scope, org?.id ?? null, "backup")) {
    return ApiResponse.error(res, "A backup for this target is already in progress", 409);
  }
  const job = await createBackupJob({
    scope,
    organisation: org,
    requestedBy: req.user.id,
    requestedByRole: req.user.role_id ?? null,
  });
  auditReq(req, "Backup Requested", `${scope} backup queued (job ${job.id})`, { orgId: org?.id ?? null, orgLabel: org?.name });
  return ApiResponse.success(res, "Backup started", { job: await serializeJobs(job) }, 202);
});

export const getJob = catchAsync(async (req, res) => {
  const job = await loadJob(req, res);
  if (!job) return;
  return ApiResponse.success(res, "Backup retrieved", { job: await serializeJobs(job) });
});

export const downloadJob = catchAsync(async (req, res) => {
  const job = await loadJob(req, res);
  if (!job) return;
  return streamBackupDownload(req, res, job, { password: req.body?.password, totp: req.body?.totp });
});

export const removeJob = catchAsync(async (req, res) => {
  const job = await loadJob(req, res);
  if (!job) return;
  return deleteBackupJob(req, res, job);
});

export const restore = catchAsync(async (req, res) => {
  return handleRestoreRequest(req, res, { allowPlatform: true });
});
