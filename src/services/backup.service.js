/**
 * backup.service.js
 *
 * Database backup / restore engine (platform DB + one DB per organisation).
 *
 * Security notes
 *  - pg_dump / psql are spawned with ARGUMENT ARRAYS (never a shell string).
 *  - The password only travels in the PGPASSWORD environment variable.
 *  - Database names come ONLY from the Organisation table / env and are
 *    validated against /^[A-Za-z0-9_]{1,63}$/ before use. SQL identifiers are
 *    additionally escaped with pg-format %I.
 *  - Client-supplied file names are never used as filesystem paths.
 *  - file_path on BackupJob never leaves the server.
 */
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import { spawn } from "child_process";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import pg from "pg";
import format from "pg-format";
import archiver from "archiver";
import { Op } from "sequelize";
import platformDb from "../models/index.js";
import config from "../config/config.js";
import logger from "../utils/logger.js";
import { evictTenantDb } from "./tenantDb.service.js";
import { beginOrgRestore, endOrgRestore } from "./restoreGate.service.js";
import { getEffectiveBackupSettings } from "./backupSettings.service.js";
import { recordPlatformAuditLog } from "./platformActivity.service.js";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DB_NAME_RE = /^[A-Za-z0-9_]{1,63}$/;
export const HEADER_PREFIX = "-- EPIC-BACKUP ";
const MAX_HEADER_BYTES = 64 * 1024;
const SAFETY_RETENTION_HOURS = 7 * 24;

// ─── Config helpers ──────────────────────────────────────────────────────────
function cfg() {
  return config[process.env.NODE_ENV || "development"];
}

export function getBackupTmpDir() {
  const dir = process.env.BACKUP_TMP_DIR
    ? path.resolve(process.env.BACKUP_TMP_DIR)
    : path.resolve(__dirname, "../../storage/private/temp/backups");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getUploadTmpDir() {
  const dir = path.join(getBackupTmpDir(), "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getPlatformDbName() {
  const name = cfg().database || process.env.DB_NAME;
  return assertDbName(name);
}

export function assertDbName(name) {
  if (typeof name !== "string" || !DB_NAME_RE.test(name)) {
    throw new Error("Invalid database name");
  }
  return name;
}

function pgBin(envKey, fallback) {
  return (process.env[envKey] || "").trim() || fallback;
}

function maintenanceConfig() {
  const c = cfg();
  const out = {
    host: c.host,
    port: parseInt(String(c.port || 5432), 10),
    user: process.env.TENANT_DB_CREATOR_USER || c.username,
    password:
      process.env.TENANT_DB_CREATOR_PASSWORD ?? c.password ?? process.env.DB_PASSWORD ?? process.env.DB_PASS,
    database: process.env.DB_MAINTENANCE_DATABASE || "postgres",
  };
  if (c.dialectOptions?.ssl) out.ssl = c.dialectOptions.ssl;
  return out;
}

async function withMaintenance(fn) {
  const client = new Client(maintenanceConfig());
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function withDatabase(dbName, fn) {
  assertDbName(dbName);
  const client = new Client({ ...maintenanceConfig(), database: dbName });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

/** Environment for child processes; password via PGPASSWORD only. */
function childEnv(user, password) {
  const c = cfg();
  const env = { ...process.env, PGPASSWORD: String(password ?? "") };
  delete env.PGPASSFILE;
  if (c.dialectOptions?.ssl) env.PGSSLMODE = "require";
  env.PGUSER = user;
  return env;
}

const tsCompact = (d = new Date()) =>
  d.toISOString().replace(/[-:T]/g, "").slice(0, 14); // YYYYMMDDHHmmss
const tsFile = (d = new Date()) => {
  const s = tsCompact(d);
  return `${s.slice(0, 8)}-${s.slice(8)}`; // YYYYMMDD-HHmmss
};

/** `<db>` + `_tag_<ts>` within the 63 char limit (db part truncated if needed). */
export function derivedDbName(db, tag, ts) {
  const suffix = `_${tag}_${ts}`;
  return `${db.slice(0, 63 - suffix.length)}${suffix}`;
}

const safeFileBase = (s) => String(s || "backup").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60) || "backup";

// ─── Process helpers ─────────────────────────────────────────────────────────
function spawnCollect(bin, args, env) {
  const child = spawn(bin, args, { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false });
  let stderr = "";
  child.stdin.on("error", () => {});
  child.stderr.on("data", (d) => {
    if (stderr.length < 16384) stderr += d.toString();
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", (e) =>
      reject(new Error(e.code === "ENOENT" ? `Executable not found: ${bin} (set PG_DUMP_PATH / PSQL_PATH)` : e.message)),
    );
    child.once("close", (code) => resolve(code));
  });
  return { child, exited, getStderr: () => stderr };
}

function tidyError(stderr, fallback) {
  const t = String(stderr || "").trim().split(/\r?\n/).slice(-6).join(" | ");
  return (t || fallback).slice(0, 800);
}

async function sha256OfFile(file) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

async function serverVersion() {
  return withMaintenance(async (c) => (await c.query("SHOW server_version")).rows[0].server_version);
}

// ─── Core: dump ──────────────────────────────────────────────────────────────
/**
 * Dump `dbName` to a gzip'd plain-SQL file with the EPIC-BACKUP header as line 1.
 */
export async function dumpDatabaseToFile({ dbName, scope, organisationId = null, outPath }) {
  assertDbName(dbName);
  const c = cfg();
  const header = {
    v: 1,
    scope,
    organisation_id: organisationId,
    database_name: dbName,
    created_at: new Date().toISOString(),
    app: "epic",
    pg_server_version: await serverVersion(),
  };
  const args = [
    "-h", String(c.host),
    "-p", String(c.port || 5432),
    "-U", String(c.username),
    "--no-owner",
    "--no-privileges",
    "--format=plain",
    "--no-password",
    `--dbname=${dbName}`,
  ];
  const { child, exited, getStderr } = spawnCollect(pgBin("PG_DUMP_PATH", "pg_dump"), args, childEnv(c.username, c.password));
  child.stdin.end();
  const gzip = zlib.createGzip();
  gzip.write(`${HEADER_PREFIX}${JSON.stringify(header)}\n`);
  const out = fs.createWriteStream(outPath, { mode: 0o600 });
  try {
    const [code] = await Promise.all([exited, pipeline(child.stdout, gzip, out)]);
    if (code !== 0) throw new Error(`pg_dump failed: ${tidyError(getStderr(), `exit code ${code}`)}`);
  } catch (err) {
    child.kill();
    out.destroy();
    await fsp.rm(outPath, { force: true }).catch(() => {});
    throw err;
  }
  const stat = await fsp.stat(outPath);
  return { size: stat.size, checksum: await sha256OfFile(outPath), header };
}

// ─── Backup header validation ────────────────────────────────────────────────
export async function readBackupHeader(filePath) {
  const fd = await fsp.open(filePath, "r");
  try {
    const magic = Buffer.alloc(2);
    const { bytesRead } = await fd.read(magic, 0, 2, 0);
    if (bytesRead < 2 || magic[0] !== 0x1f || magic[1] !== 0x8b) {
      throw new Error("File is not a valid gzip backup");
    }
  } finally {
    await fd.close();
  }
  const gunzip = zlib.createGunzip();
  const src = fs.createReadStream(filePath, { start: 0, end: MAX_HEADER_BYTES });
  const line = await new Promise((resolve, reject) => {
    let buf = "";
    gunzip.on("data", (d) => {
      buf += d.toString("utf8");
      const i = buf.indexOf("\n");
      if (i >= 0) resolve(buf.slice(0, i));
      else if (buf.length > MAX_HEADER_BYTES) resolve(buf);
    });
    gunzip.on("end", () => resolve(buf));
    gunzip.on("error", (e) => {
      // Truncated read of a larger gzip: only fatal if no header line was obtained.
      if (buf.indexOf("\n") >= 0) resolve(buf.slice(0, buf.indexOf("\n")));
      else reject(new Error("File is not a valid gzip backup"));
    });
    src.on("error", reject);
    src.pipe(gunzip);
  }).finally(() => {
    src.destroy();
    gunzip.destroy();
  });
  if (!line.startsWith(HEADER_PREFIX)) throw new Error("Not an EPiC backup file (missing header)");
  let header;
  try {
    header = JSON.parse(line.slice(HEADER_PREFIX.length));
  } catch {
    throw new Error("Backup header is corrupt");
  }
  if (!header || header.v !== 1 || header.app !== "epic") throw new Error("Unsupported backup format version");
  return header;
}

/** Throws a readable Error when the header does not match the restore target. */
export function validateHeaderForTarget(header, { scope, organisationId, databaseName }) {
  if (header.scope !== scope) {
    throw new Error(`This is a ${header.scope} backup; a ${scope} backup is required`);
  }
  if (scope === "organisation") {
    if (Number(header.organisation_id) !== Number(organisationId) || header.database_name !== databaseName) {
      throw new Error("This backup belongs to another organisation and cannot be restored here");
    }
  } else if (scope === "platform") {
    if (header.database_name !== databaseName) {
      throw new Error("This backup was taken from a different platform database");
    }
  }
}

// ─── Core: restore into a fresh DB ───────────────────────────────────────────
export async function createEmptyDatabase(name) {
  assertDbName(name);
  await withMaintenance(async (c) => {
    const ex = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (ex.rowCount) throw new Error("Temporary database already exists");
    await c.query(format("CREATE DATABASE %I", name));
  });
}

export async function dropDatabaseQuietly(name) {
  try {
    assertDbName(name);
    await withMaintenance(async (c) => {
      await c.query(format("DROP DATABASE IF EXISTS %I WITH (FORCE)", name));
    });
  } catch (err) {
    logger.warn({ err: err.message, name }, "backup: could not drop database");
  }
}

export async function restoreFileIntoDatabase(filePath, targetDb) {
  assertDbName(targetDb);
  const m = maintenanceConfig();
  const args = [
    "-h", String(m.host),
    "-p", String(m.port),
    "-U", String(m.user),
    "-d", targetDb,
    "--no-password",
    "-X", "-q",
    "-v", "ON_ERROR_STOP=1",
    "--single-transaction",
    "-f", "-",
  ];
  const env = childEnv(m.user, m.password);
  env.PGDATABASE = targetDb;
  const { child, exited, getStderr } = spawnCollect(pgBin("PSQL_PATH", "psql"), args, env);
  child.stdout.resume();
  const piped = pipeline(fs.createReadStream(filePath), zlib.createGunzip(), child.stdin).catch((e) => {
    // psql exiting early (ON_ERROR_STOP) closes stdin => EPIPE; the exit code explains it.
    if (e.code !== "EPIPE" && e.code !== "ERR_STREAM_PREMATURE_CLOSE" && e.code !== "ERR_STREAM_DESTROYED") throw e;
  });
  let code;
  try {
    [code] = await Promise.all([exited, piped]);
  } catch (err) {
    child.kill();
    throw err;
  }
  if (code !== 0) throw new Error(`Restore failed: ${tidyError(getStderr(), `psql exit code ${code}`)}`);
}

export async function sanityCheckDatabase(dbName, requiredTables) {
  return withDatabase(dbName, async (c) => {
    for (const t of requiredTables) {
      const r = await c.query("SELECT to_regclass($1) AS reg", [`public.${t}`]);
      if (!r.rows[0].reg) throw new Error(`Sanity check failed: table "${t}" is missing from the restored database`);
    }
    const first = requiredTables[0];
    const cnt = await c.query(format("SELECT count(*)::int AS n FROM public.%I", first));
    return { table: first, rows: cnt.rows[0].n };
  });
}

const TENANT_REQUIRED_TABLES = ["users", "roles", "cases"];
const PLATFORM_REQUIRED_TABLES = ["users", "organisations", "platform_settings"];

// ─── Core: swap ──────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Rename live -> preName, temp -> live. Caller owns the maintenance gate.
 */
export async function swapDatabases({ liveDb, tempDb, preName }) {
  assertDbName(liveDb);
  assertDbName(tempDb);
  assertDbName(preName);
  await withMaintenance(async (c) => {
    let renamedFirst = false;
    try {
      // Stop new connections (cron jobs etc.) and drop existing ones.
      await c.query(format("ALTER DATABASE %I WITH ALLOW_CONNECTIONS false", liveDb));
      evictTenantDb(liveDb);
      let lastErr;
      for (let i = 0; i < 6 && !renamedFirst; i++) {
        await c.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
          [liveDb],
        );
        try {
          await c.query(format("ALTER DATABASE %I RENAME TO %I", liveDb, preName));
          renamedFirst = true;
        } catch (e) {
          lastErr = e;
          await sleep(500);
        }
      }
      if (!renamedFirst) throw lastErr || new Error("Could not rename the live database");
      await c.query(format("ALTER DATABASE %I RENAME TO %I", tempDb, liveDb));
      // Old DB is kept for manual recovery: allow admins to connect to it again.
      await c.query(format("ALTER DATABASE %I WITH ALLOW_CONNECTIONS true", preName)).catch(() => {});
    } catch (err) {
      if (renamedFirst) {
        try {
          await c.query(format("ALTER DATABASE %I RENAME TO %I", preName, liveDb));
        } catch (e2) {
          logger.error({ err: e2.message }, "backup: CRITICAL could not roll back database rename");
        }
      }
      await c.query(format("ALTER DATABASE %I WITH ALLOW_CONNECTIONS true", liveDb)).catch(() => {});
      throw err;
    }
  });
  evictTenantDb(liveDb);
}

// ─── Job serialisation ───────────────────────────────────────────────────────
export async function serializeJobs(jobs) {
  const list = Array.isArray(jobs) ? jobs : [jobs];
  const orgIds = [...new Set(list.map((j) => j.organisation_id).filter((x) => x != null))];
  const userIds = [...new Set(list.map((j) => j.requested_by).filter((x) => x != null))];
  const orgs = orgIds.length
    ? await platformDb.Organisation.findAll({ where: { id: orgIds }, attributes: ["id", "name"] })
    : [];
  const users = userIds.length
    ? await platformDb.User.findAll({ where: { id: userIds }, attributes: ["id", "first_name", "last_name", "email"] })
    : [];
  const orgMap = new Map(orgs.map((o) => [o.id, o.name]));
  const userMap = new Map(
    users.map((u) => [u.id, [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email]),
  );
  const out = list.map((j) => {
    const m = j.meta || {};
    const meta = {};
    if (m.safety) meta.safety = true;
    if (j.scope === "platform" && m.restored_db_name) meta.restored_db_name = m.restored_db_name;
    if (m.safety_backup_job_id) meta.safety_backup_job_id = m.safety_backup_job_id;
    return {
      id: j.id,
      kind: j.kind,
      scope: j.scope,
      organisation_id: j.organisation_id,
      organisation_name: j.organisation_id != null ? orgMap.get(j.organisation_id) ?? null : null,
      status: j.status,
      stage: j.stage,
      file_name: j.file_name,
      file_size: j.file_size != null ? Number(j.file_size) : null,
      checksum: j.checksum,
      error: j.error,
      meta,
      created_at: j.created_at,
      started_at: j.started_at,
      completed_at: j.completed_at,
      expires_at: j.expires_at,
      requested_by_name: j.requested_by != null ? userMap.get(j.requested_by) ?? null : null,
    };
  });
  return Array.isArray(jobs) ? out : out[0];
}

// ─── Job creation + queue ────────────────────────────────────────────────────
const queue = [];
let draining = false;

function enqueue(jobId) {
  queue.push(jobId);
  if (!draining) {
    draining = true;
    setImmediate(drain);
  }
}

async function drain() {
  try {
    while (queue.length) {
      const id = queue.shift();
      try {
        const job = await platformDb.BackupJob.findByPk(id);
        if (!job || job.status !== "pending") continue;
        if (job.kind === "backup") await runBackupJob(job);
        else await runRestoreJob(job);
      } catch (err) {
        logger.error({ err: err.message, id }, "backup: job runner error");
      }
    }
  } finally {
    draining = false;
    if (queue.length) {
      draining = true;
      setImmediate(drain);
    }
  }
}

const active = (scope, organisationId, kind) =>
  platformDb.BackupJob.findOne({
    where: {
      kind,
      scope,
      organisation_id: organisationId ?? null,
      status: { [Op.in]: ["pending", "running"] },
    },
  });

export async function findActiveJob(scope, organisationId, kind) {
  return active(scope, organisationId, kind);
}

export async function createBackupJob({ scope, organisation, requestedBy, requestedByRole, meta = null }) {
  const settings = await getEffectiveBackupSettings(organisation?.id ?? null);
  const job = await platformDb.BackupJob.create({
    kind: "backup",
    scope,
    organisation_id: organisation?.id ?? null,
    database_name: scope === "organisation" ? organisation.database_name : scope === "platform" ? getPlatformDbName() : null,
    status: "pending",
    stage: "queued",
    meta,
    requested_by: requestedBy,
    requested_by_role: requestedByRole,
    expires_at: new Date(Date.now() + settings.retentionHours * 3600 * 1000),
  });
  enqueue(job.id);
  return job;
}

export async function createRestoreJob({ scope, organisation, uploadPath, originalName, size, requestedBy, requestedByRole }) {
  const job = await platformDb.BackupJob.create({
    kind: "restore",
    scope,
    organisation_id: organisation?.id ?? null,
    database_name: scope === "organisation" ? organisation.database_name : getPlatformDbName(),
    status: "pending",
    stage: "queued",
    file_path: uploadPath,
    file_name: safeFileBase(originalName).slice(0, 200),
    file_size: size,
    meta: null,
    requested_by: requestedBy,
    requested_by_role: requestedByRole,
  });
  enqueue(job.id);
  return job;
}

const setStage = (job, stage) => job.update({ stage });

async function failJob(job, err, stage) {
  const msg = String(err?.message || err).slice(0, 1000);
  logger.error({ jobId: job.id, stage: stage || job.stage, err: msg }, "backup: job failed");
  await job
    .update({ status: "failed", stage: stage || job.stage, error: msg, completed_at: new Date(), file_path: null })
    .catch(() => {});
  audit(job, `${job.kind === "backup" ? "Backup" : "Restore"} Failed`, msg, "Failed");
}

function audit(job, action, description, status = "Success", extra = {}) {
  return recordPlatformAuditLog({
    category: "Backup",
    action,
    user: extra.userLabel || `user#${job.requested_by ?? "system"}`,
    org: extra.orgLabel || (job.organisation_id ? `org#${job.organisation_id}` : "Global System"),
    description,
    status,
    user_id: job.requested_by ?? null,
    ip_address: extra.ip ?? null,
  });
}
export { audit as auditBackupEvent };

async function dumpTenantsIntoZip(job, zipPath) {
  const tmp = getBackupTmpDir();
  const targets = [{ name: "platform", db: getPlatformDbName(), scope: "platform", orgId: null }];
  const orgs = await platformDb.Organisation.findAll({
    where: { database_name: { [Op.ne]: null } },
    attributes: ["id", "slug", "database_name", "status"],
    order: [["id", "ASC"]],
  });
  for (const o of orgs) {
    if (!DB_NAME_RE.test(o.database_name || "")) continue;
    targets.push({ name: safeFileBase(o.slug || o.database_name), db: o.database_name, scope: "organisation", orgId: o.id });
  }
  const out = fs.createWriteStream(zipPath, { mode: 0o600 });
  const zip = archiver("zip", { zlib: { level: 0 } });
  const zipDone = pipeline(zip, out);
  const temps = [];
  const failed = [];
  const stamp = tsFile();
  try {
    let ok = 0;
    for (const t of targets) {
      await setStage(job, `dumping:${t.name}`);
      const p = path.join(tmp, `${job.id}-${t.orgId ?? "platform"}.sql.gz`);
      temps.push(p);
      try {
        await dumpDatabaseToFile({ dbName: t.db, scope: t.scope, organisationId: t.orgId, outPath: p });
        zip.file(p, { name: `${t.name}-${stamp}.sql.gz` });
        ok++;
      } catch (e) {
        failed.push(t.name);
        logger.warn({ db: t.db, err: e.message }, "backup: tenant dump failed inside 'all' job");
      }
    }
    if (!ok || failed.includes("platform")) throw new Error(`Platform dump failed or nothing was backed up (${failed.join(", ")})`);
    zip.append(
      "Restore of an 'all' archive is not supported. Extract the single .sql.gz you need and restore it\n" +
        "from the Backups page for that organisation (or platform, if enabled).\n",
      { name: "README.txt" },
    );
    await zip.finalize();
    await zipDone;
  } catch (err) {
    zip.abort();
    out.destroy();
    await fsp.rm(zipPath, { force: true }).catch(() => {});
    throw err;
  } finally {
    await Promise.all(temps.map((p) => fsp.rm(p, { force: true }).catch(() => {})));
  }
  return failed;
}

async function runBackupJob(job) {
  await job.update({ status: "running", started_at: new Date(), stage: "starting" });
  const tmp = getBackupTmpDir();
  const stamp = tsFile();
  let ext = ".sql.gz";
  let base;
  try {
    if (job.scope === "organisation") {
      const org = await platformDb.Organisation.findByPk(job.organisation_id, { attributes: ["id", "slug", "database_name"] });
      if (!org?.database_name) throw new Error("Organisation has no database");
      assertDbName(org.database_name);
      base = safeFileBase(org.slug || org.database_name);
    } else if (job.scope === "platform") {
      base = safeFileBase(getPlatformDbName());
    } else {
      base = "epic-all";
      ext = ".zip";
    }
    const filePath = path.join(tmp, `${job.id}${ext}`);
    await job.update({ file_path: filePath });
    let warning = null;
    if (job.scope === "all") {
      const failed = await dumpTenantsIntoZip(job, filePath);
      if (failed.length) warning = `Skipped (dump failed): ${failed.join(", ")}`;
    } else {
      await setStage(job, "dumping");
      await dumpDatabaseToFile({
        dbName: job.database_name,
        scope: job.scope,
        organisationId: job.organisation_id,
        outPath: filePath,
      });
    }
    await setStage(job, "finalising");
    const stat = await fsp.stat(filePath);
    const checksum = await sha256OfFile(filePath);
    await job.update({
      status: "completed",
      stage: "done",
      file_name: `${base}-${stamp}${ext}`,
      file_size: stat.size,
      checksum,
      error: warning,
      completed_at: new Date(),
    });
    audit(job, job.meta?.safety ? "Safety Backup Created" : "Backup Created", `${job.scope} backup completed (${stat.size} bytes)`);
  } catch (err) {
    if (job.file_path) await fsp.rm(job.file_path, { force: true }).catch(() => {});
    await failJob(job, err);
  }
}

// ─── Restore job ─────────────────────────────────────────────────────────────
async function runSafetyBackup(restoreJob, org) {
  const settings = await getEffectiveBackupSettings(org.id);
  const sj = await platformDb.BackupJob.create({
    kind: "backup",
    scope: "organisation",
    organisation_id: org.id,
    database_name: org.database_name,
    status: "running",
    stage: "dumping",
    started_at: new Date(),
    meta: { safety: true, for_restore_job: restoreJob.id },
    requested_by: restoreJob.requested_by,
    requested_by_role: restoreJob.requested_by_role,
    expires_at: new Date(Date.now() + Math.max(SAFETY_RETENTION_HOURS, settings.retentionHours) * 3600 * 1000),
  });
  const filePath = path.join(getBackupTmpDir(), `${sj.id}.sql.gz`);
  await sj.update({ file_path: filePath });
  try {
    const r = await dumpDatabaseToFile({ dbName: org.database_name, scope: "organisation", organisationId: org.id, outPath: filePath });
    await sj.update({
      status: "completed",
      stage: "done",
      file_name: `${safeFileBase(org.slug || org.database_name)}-pre-restore-${tsFile()}.sql.gz`,
      file_size: r.size,
      checksum: r.checksum,
      completed_at: new Date(),
    });
    audit(sj, "Safety Backup Created", `Pre-restore safety backup (${r.size} bytes)`);
    return sj;
  } catch (err) {
    await sj.update({ status: "failed", stage: "dumping", error: String(err.message).slice(0, 1000), completed_at: new Date(), file_path: null });
    throw new Error(`Safety backup failed, restore aborted: ${err.message}`);
  }
}

async function runRestoreJob(job) {
  await job.update({ status: "running", started_at: new Date(), stage: "validating" });
  const uploadPath = job.file_path;
  let tempDb = null;
  let gated = false;
  let org = null;
  try {
    if (!uploadPath || !fs.existsSync(uploadPath)) throw new Error("Uploaded backup file is missing on the server");
    const isPlatform = job.scope === "platform";
    let liveDb;
    if (isPlatform) {
      if (process.env.BACKUP_ALLOW_PLATFORM_RESTORE !== "true") throw new Error("Platform restore is disabled");
      liveDb = getPlatformDbName();
    } else {
      org = await platformDb.Organisation.findByPk(job.organisation_id, { attributes: ["id", "slug", "name", "database_name"] });
      if (!org?.database_name) throw new Error("Organisation has no database");
      liveDb = assertDbName(org.database_name);
    }
    const header = await readBackupHeader(uploadPath);
    validateHeaderForTarget(header, { scope: job.scope, organisationId: job.organisation_id, databaseName: liveDb });

    const ts = tsCompact();
    tempDb = derivedDbName(liveDb, isPlatform ? "restored" : "restore", ts);
    await setStage(job, "creating_temp_db");
    await createEmptyDatabase(tempDb);

    await setStage(job, "restoring_data");
    await restoreFileIntoDatabase(uploadPath, tempDb);

    await setStage(job, "verifying");
    const sanity = await sanityCheckDatabase(tempDb, isPlatform ? PLATFORM_REQUIRED_TABLES : TENANT_REQUIRED_TABLES);

    if (isPlatform) {
      await job.update({
        status: "completed",
        stage: "done",
        completed_at: new Date(),
        meta: { restored_db_name: tempDb, rows_checked: sanity },
        error: `Restored into new database "${tempDb}". The live platform database was NOT changed. Review it, then set DB_NAME=${tempDb} and restart the API to switch.`,
      });
      audit(job, "Platform Restore Completed", `Restored into ${tempDb} (live DB untouched)`);
      tempDb = null; // keep it
      return;
    }

    await setStage(job, "safety_backup");
    const safety = await runSafetyBackup(job, org);

    await setStage(job, "swapping");
    const preName = derivedDbName(liveDb, "pre_restore", tsCompact());
    beginOrgRestore(org.id);
    gated = true;
    await swapDatabases({ liveDb, tempDb, preName });
    tempDb = null; // now the live DB
    const meta = { safety_backup_job_id: safety.id, pre_restore_db: preName, rows_checked: sanity };

    await setStage(job, "migrating");
    let warning = null;
    try {
      const { runTenantMigrations } = await import("../migrations/run.js");
      evictTenantDb(liveDb);
      await runTenantMigrations(liveDb);
      meta.migrations = "ok";
    } catch (mErr) {
      meta.migrations = "failed";
      warning = `Restore completed but schema migration reported an error: ${String(mErr.message).slice(0, 400)}`;
      logger.error({ err: mErr.message, liveDb }, "backup: post-restore migration failed");
    } finally {
      evictTenantDb(liveDb);
    }
    await job.update({ status: "completed", stage: "done", completed_at: new Date(), meta, error: warning });
    audit(job, "Organisation Restore Completed", `Organisation database restored; previous DB kept as ${preName}`);
  } catch (err) {
    if (tempDb) await dropDatabaseQuietly(tempDb);
    await failJob(job, err);
  } finally {
    if (gated) endOrgRestore(org.id);
    if (uploadPath) await fsp.rm(uploadPath, { force: true }).catch(() => {});
    await job.update({ file_path: null }).catch(() => {});
  }
}

// ─── Download / delete helpers ───────────────────────────────────────────────
export async function removeJobFile(job) {
  if (job.file_path) await fsp.rm(job.file_path, { force: true }).catch(() => {});
}

export async function expireJob(job) {
  await removeJobFile(job);
  await job.update({ status: "expired", file_path: null });
}

// ─── Cleanup (registered in cron by BE-2) ────────────────────────────────────
const PROCESS_STARTED_AT = new Date();
let _staleSwept = false;
export async function markStaleJobs({ force = false, olderThanMs = 0 } = {}) {
  if (_staleSwept && !force) return 0;
  _staleSwept = true;
  const where = { status: { [Op.in]: ["running", "pending"] }, created_at: { [Op.lt]: PROCESS_STARTED_AT } };
  if (olderThanMs) where.created_at = { [Op.lt]: new Date(Math.min(PROCESS_STARTED_AT.getTime(), Date.now() - olderThanMs)) };
  const jobs = await platformDb.BackupJob.findAll({ where });
  for (const j of jobs) {
    if (queue.includes(j.id)) continue;
    await removeJobFile(j);
    await j.update({ status: "failed", error: "Interrupted (server restarted or job timed out)", completed_at: new Date(), file_path: null });
  }
  return jobs.length;
}

export async function cleanupExpiredBackups() {
  let expired = 0;
  try {
    await markStaleJobs();
    const stale = await platformDb.BackupJob.findAll({ where: { status: "completed", expires_at: { [Op.lt]: new Date() } } });
    for (const j of stale) {
      await expireJob(j);
      expired++;
    }
    // Orphan sweep: files in the tmp dir not referenced by any live job and older than 3 days.
    const dir = getBackupTmpDir();
    const referenced = new Set(
      (await platformDb.BackupJob.findAll({ where: { file_path: { [Op.ne]: null } }, attributes: ["file_path"] })).map((j) => j.file_path),
    );
    for (const sub of [dir, path.join(dir, "uploads")]) {
      let names = [];
      try { names = await fsp.readdir(sub); } catch { continue; }
      for (const n of names) {
        const p = path.join(sub, n);
        try {
          const st = await fsp.stat(p);
          if (st.isFile() && !referenced.has(p) && Date.now() - st.mtimeMs > 3 * 24 * 3600 * 1000) await fsp.rm(p, { force: true });
        } catch { /* ignore */ }
      }
    }
    await dropOldPreRestoreDatabases().catch((e) => logger.warn({ err: e.message }, "backup: pre-restore cleanup failed"));
  } catch (err) {
    logger.error({ err: err.message }, "backup: cleanupExpiredBackups failed");
  }
  return { expired };
}

/**
 * Drops `<tenant_db>_pre_restore_<ts>` databases older than BACKUP_PRE_RESTORE_KEEP_DAYS (default 7).
 * Only names that exactly match a known tenant DB's derived pre-restore name are touched.
 */
export async function dropOldPreRestoreDatabases() {
  const keepDays = Math.max(1, Number(process.env.BACKUP_PRE_RESTORE_KEEP_DAYS) || 7);
  const cutoff = Date.now() - keepDays * 24 * 3600 * 1000;
  const orgs = await platformDb.Organisation.findAll({ where: { database_name: { [Op.ne]: null } }, attributes: ["database_name"] });
  const known = orgs.map((o) => o.database_name).filter((n) => DB_NAME_RE.test(n));
  const dropped = [];
  await withMaintenance(async (c) => {
    const r = await c.query("SELECT datname FROM pg_database WHERE datname LIKE $1", ["%\\_pre\\_restore\\_%"]);
    for (const { datname } of r.rows) {
      const m = /_pre_restore_(\d{14})$/.exec(datname);
      if (!m) continue;
      const ts = m[1];
      if (!known.some((k) => derivedDbName(k, "pre_restore", ts) === datname)) continue;
      const when = Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8), +ts.slice(8, 10), +ts.slice(10, 12), +ts.slice(12, 14));
      if (when >= cutoff) continue;
      await c.query(format("DROP DATABASE IF EXISTS %I WITH (FORCE)", datname));
      dropped.push(datname);
    }
  });
  return dropped;
}

// Mark stale jobs from a previous process shortly after startup (non-blocking).
setTimeout(() => {
  markStaleJobs().catch(() => {});
}, 15_000).unref?.();
