/**
 * Shared helpers for the superadmin and org-admin backup controllers.
 */
import fs from "fs";
import fsp from "fs/promises";
import { pipeline } from "stream/promises";
import bcrypt from "bcryptjs";
import speakeasy from "speakeasy";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { rateLimit } from "express-rate-limit";
import platformDb from "../../../models/index.js";
import ApiResponse from "../../../utils/apiResponse.js";
import { decrypt as decryptSecret } from "../../../utils/fieldEncryption.js";
import logger from "../../../utils/logger.js";
import { getEffectiveBackupSettings } from "../../../services/backupSettings.service.js";
import {
  auditBackupEvent,
  createRestoreJob,
  expireJob,
  findActiveJob,
  getPlatformDbName,
  getUploadTmpDir,
  readBackupHeader,
  serializeJobs,
  validateHeaderForTarget,
} from "../../../services/backup.service.js";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ip = (req) => req.ip || req.socket?.remoteAddress || null;
export const actorLabel = (req) => req.user?.email || `user#${req.user?.id}`;

export function auditReq(req, action, description, { status = "Success", orgLabel, orgId } = {}) {
  return auditBackupEvent(
    { requested_by: req.user?.id ?? null, organisation_id: orgId ?? null },
    action,
    description,
    status,
    { userLabel: actorLabel(req), ip: ip(req), orgLabel },
  );
}

/** Rate limit for download + restore (per authenticated user). */
export const backupSensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `backup:${req.user?.id ?? "anon"}`,
  validate: false,
  handler: (req, res) =>
    ApiResponse.error(res, "Too many backup download/restore attempts. Please try again later.", 429),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.DISABLE_RATE_LIMIT === "true",
});

/**
 * Re-authenticate the requester (password + TOTP when MFA is on).
 * Returns null when OK, otherwise an object describing the failure.
 * NOTE: failures use 403 (not 401) so the frontend does not treat them as an expired session.
 */
export async function verifyReauth(req, { password, totp } = {}) {
  const user = req.user?.id
    ? await platformDb.User.findByPk(req.user.id, {
        attributes: ["id", "email", "password", "status", "two_factor_enabled", "two_factor_secret"],
      })
    : null;
  const fail = (code, message) => ({ status: 403, code, message });
  if (!user || user.status !== "active") return fail("REAUTH_FAILED", "Re-authentication failed");
  if (!password || typeof password !== "string") return fail("PASSWORD_REQUIRED", "Password is required");
  const okPw = await bcrypt.compare(password, user.password || "");
  if (!okPw) return fail("REAUTH_FAILED", "Incorrect password");
  if (user.two_factor_enabled) {
    if (!totp) return fail("TOTP_REQUIRED", "A two-factor authentication code is required");
    let ok = false;
    try {
      ok = speakeasy.totp.verify({
        secret: decryptSecret(user.two_factor_secret),
        encoding: "base32",
        token: String(totp).replace(/\s+/g, ""),
        window: 1,
      });
    } catch {
      ok = false;
    }
    if (!ok) return fail("REAUTH_FAILED", "Invalid two-factor authentication code");
  }
  return null;
}

export async function rejectIfReauthFails(req, res, creds, what, orgId = null) {
  const failure = await verifyReauth(req, creds);
  if (!failure) return false;
  auditReq(req, `${what} Re-auth Failed`, failure.message, { status: "Failed", orgId });
  ApiResponse.error(res, failure.message, failure.status, null, failure.code);
  return true;
}

// ─── Download ────────────────────────────────────────────────────────────────
export async function streamBackupDownload(req, res, job, creds) {
  if (job.kind !== "backup" || job.status === "pending" || job.status === "running") {
    return ApiResponse.error(res, "This backup is not available for download", 409);
  }
  if (job.status === "failed") return ApiResponse.error(res, "This backup failed and has no file", 409);
  if (await rejectIfReauthFails(req, res, creds, "Backup Download", job.organisation_id)) return;
  if (job.status === "expired" || (job.expires_at && new Date(job.expires_at) < new Date())) {
    if (job.status !== "expired") await expireJob(job);
    return ApiResponse.error(res, "This backup has expired and was removed", 410);
  }
  if (!job.file_path || !fs.existsSync(job.file_path)) {
    return ApiResponse.error(res, "Backup file is no longer available", 410);
  }
  const stat = await fsp.stat(job.file_path);
  const name = String(job.file_name || `backup-${job.id}`).replace(/[^A-Za-z0-9._-]/g, "_");
  const isZip = name.endsWith(".zip");
  res.status(200);
  res.setHeader("Content-Type", isZip ? "application/zip" : "application/gzip");
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  auditReq(req, "Backup Downloaded", `Downloaded ${job.scope} backup ${job.id}`, { orgId: job.organisation_id });
  try {
    await pipeline(fs.createReadStream(job.file_path), res);
  } catch (err) {
    logger.warn({ err: err.message, jobId: job.id }, "backup: download stream interrupted");
    if (!res.writableEnded) res.destroy();
  }
}

export async function deleteBackupJob(req, res, job) {
  if (job.kind !== "backup") return ApiResponse.error(res, "Only backups can be deleted", 400);
  if (job.status === "pending" || job.status === "running") {
    return ApiResponse.error(res, "Backup is still in progress", 409);
  }
  if (job.status !== "expired") await expireJob(job);
  auditReq(req, "Backup Deleted", `Deleted ${job.scope} backup ${job.id}`, { orgId: job.organisation_id });
  return ApiResponse.success(res, "Backup deleted", { job: await serializeJobs(job) });
}

// ─── Restore upload ──────────────────────────────────────────────────────────
export function restoreUploadMiddleware(req, res, next) {
  (async () => {
    const s = await getEffectiveBackupSettings(req.user?.organisation_id ?? null);
    const upload = multer({
      storage: multer.diskStorage({
        destination: (r, f, cb) => cb(null, getUploadTmpDir()),
        filename: (r, f, cb) => cb(null, `${uuidv4()}.sql.gz`),
      }),
      limits: { fileSize: s.maxUploadMb * 1024 * 1024, files: 1, fields: 10, fieldSize: 4096, parts: 15 },
      fileFilter: (r, file, cb) => {
        if (!/\.sql\.gz$/i.test(file.originalname || "")) {
          return cb(Object.assign(new Error("Only .sql.gz backup files are accepted"), { code: "BAD_TYPE" }));
        }
        cb(null, true);
      },
    }).single("file");
    upload(req, res, (err) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") {
        return ApiResponse.error(res, `Backup file exceeds the ${s.maxUploadMb} MB upload limit`, 413);
      }
      return ApiResponse.error(res, err.code === "BAD_TYPE" ? err.message : "Invalid upload", 400);
    });
  })().catch(next);
}

async function isGzipMagic(p) {
  const fd = await fsp.open(p, "r");
  try {
    const b = Buffer.alloc(2);
    const { bytesRead } = await fd.read(b, 0, 2, 0);
    return bytesRead === 2 && b[0] === 0x1f && b[1] === 0x8b;
  } finally {
    await fd.close();
  }
}

/**
 * Shared restore request handler.
 * @param {{organisationId?: number, allowPlatform: boolean}} opts organisationId forces the target (org admin).
 */
export async function handleRestoreRequest(req, res, opts) {
  const file = req.file;
  let handedOff = false;
  try {
    if (!file) return ApiResponse.badRequest(res, "Backup file is required");
    const body = req.body || {};
    const scope = opts.organisationId != null ? "organisation" : body.scope;
    if (scope !== "organisation" && scope !== "platform") return ApiResponse.badRequest(res, "scope must be organisation or platform");

    let org = null;
    let expectedName;
    if (scope === "platform") {
      if (!opts.allowPlatform) return ApiResponse.forbidden(res, "Platform restore is not permitted");
      if (process.env.BACKUP_ALLOW_PLATFORM_RESTORE !== "true") {
        return ApiResponse.forbidden(res, "Platform restore is disabled on this server (BACKUP_ALLOW_PLATFORM_RESTORE)");
      }
      expectedName = getPlatformDbName();
    } else {
      const orgId = opts.organisationId != null ? Number(opts.organisationId) : Number(body.organisation_id);
      if (!Number.isInteger(orgId) || orgId <= 0) return ApiResponse.badRequest(res, "organisation_id is required");
      org = await platformDb.Organisation.findByPk(orgId, { attributes: ["id", "name", "slug", "database_name"] });
      if (!org || !org.database_name) return ApiResponse.notFound(res, "Organisation not found");
      expectedName = org.name;
    }
    if (typeof body.confirm_name !== "string" || body.confirm_name !== expectedName) {
      return ApiResponse.badRequest(res, "Confirmation name does not match");
    }
    if (await rejectIfReauthFails(req, res, { password: body.password, totp: body.totp }, "Restore", org?.id ?? null)) return;

    try {
      if (!(await isGzipMagic(file.path))) throw new Error("File is not a valid gzip backup");
      const header = await readBackupHeader(file.path);
      validateHeaderForTarget(header, {
        scope,
        organisationId: org?.id ?? null,
        databaseName: scope === "platform" ? getPlatformDbName() : org.database_name,
      });
    } catch (e) {
      auditReq(req, "Restore Rejected", e.message, { status: "Failed", orgId: org?.id ?? null });
      return ApiResponse.badRequest(res, e.message);
    }

    if (await findActiveJob(scope, org?.id ?? null, "restore")) {
      return ApiResponse.error(res, "A restore is already in progress for this target", 409);
    }
    const job = await createRestoreJob({
      scope,
      organisation: org,
      uploadPath: file.path,
      originalName: file.originalname,
      size: file.size,
      requestedBy: req.user.id,
      requestedByRole: req.user.role_id ?? null,
    });
    handedOff = true;
    auditReq(req, "Restore Requested", `${scope} restore queued (job ${job.id})`, { orgId: org?.id ?? null });
    return ApiResponse.success(res, "Restore started", { job: await serializeJobs(job) }, 202);
  } finally {
    if (!handedOff && file?.path) await fsp.rm(file.path, { force: true }).catch(() => {});
  }
}

// ─── Misc ────────────────────────────────────────────────────────────────────
export function parsePaging(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

export async function lastActivityByOrg(orgIds) {
  if (!orgIds.length) return new Map();
  const rows = await platformDb.sequelize.query(
    `SELECT organisation_id, kind, MAX(completed_at) AS last_at
       FROM backup_jobs
      WHERE organisation_id IN (:ids) AND completed_at IS NOT NULL
        AND ((kind = 'backup' AND status IN ('completed','expired')) OR (kind = 'restore' AND status = 'completed'))
      GROUP BY organisation_id, kind`,
    { replacements: { ids: orgIds }, type: platformDb.Sequelize.QueryTypes.SELECT },
  );
  const m = new Map();
  for (const r of rows) {
    const e = m.get(r.organisation_id) || {};
    e[r.kind] = r.last_at;
    m.set(r.organisation_id, e);
  }
  return m;
}
