#!/usr/bin/env node
/**
 * backup.js — Platform database backup script for EPiC API.
 *
 * What it does:
 *   1. Runs pg_dump against the platform database, piped through gzip.
 *   2. Saves the compressed dump to ./backups/platform-YYYY-MM-DD.sql.gz
 *      (relative to the Server/ directory, or $BACKUP_LOCAL_DIR if set).
 *   3. If AWS_S3_BACKUP_BUCKET env var is set, uploads the file to S3 using
 *      the AWS CLI (same approach as backup-tenant.sh).
 *      To use the @aws-sdk/client-s3 Node SDK instead, install it first:
 *        npm install @aws-sdk/client-s3
 *      then switch the S3 block below.
 *   4. Prunes local backups older than 30 files (keeps most recent 30).
 *   5. Exits 0 on success, 1 on failure — the daily job reads the exit code.
 *
 * Required env vars (same as backup-tenant.sh):
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 *
 * Optional:
 *   BACKUP_LOCAL_DIR   — override local backup directory  (default: ./backups)
 *   AWS_S3_BACKUP_BUCKET — S3 bucket name; upload skipped when absent
 *   AWS_S3_BACKUP_PREFIX — S3 key prefix                  (default: backups/platform)
 */

import { execFile, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

// ── Paths ──────────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Server/ is one directory above scripts/
const SERVER_ROOT = path.resolve(__dirname, "..");
const BACKUP_DIR  = process.env.BACKUP_LOCAL_DIR
  ? path.resolve(process.env.BACKUP_LOCAL_DIR)
  : path.join(SERVER_ROOT, "backups");

// ── Database config ────────────────────────────────────────────────────────────
const DB_HOST = process.env.DB_HOST || "localhost";
const DB_PORT = process.env.DB_PORT || "5432";
const DB_USER = process.env.DB_USER || "postgres";
const DB_PASS = process.env.DB_PASSWORD || "postgres";
const DB_NAME = process.env.DB_NAME || "epic_api";

// ── S3 config ──────────────────────────────────────────────────────────────────
const S3_BUCKET = process.env.AWS_S3_BACKUP_BUCKET || "";
const S3_PREFIX = process.env.AWS_S3_BACKUP_PREFIX || "backups/platform";

// ── Retention ──────────────────────────────────────────────────────────────────
const KEEP_LAST_N = 30;

// ── Helpers ────────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function logErr(msg, err) {
  const ts = new Date().toISOString();
  console.error(`[${ts}] ERROR: ${msg}`, err?.message || err || "");
}

/** Format today's date as YYYY-MM-DD. */
function todayStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Run pg_dump | gzip > outFile using child_process.spawn so the compressed
 * stream never has to fully materialise in memory.
 */
function runPgDump(outFile) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PGPASSWORD: DB_PASS };

    const dump = spawn(
      "pg_dump",
      [
        `--host=${DB_HOST}`,
        `--port=${DB_PORT}`,
        `--username=${DB_USER}`,
        "--no-password",
        "--format=plain",
        "--no-owner",
        "--no-acl",
        DB_NAME,
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] }
    );

    const gz = spawn("gzip", ["-9"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const out = fs.createWriteStream(outFile);

    // pg_dump stdout → gzip stdin
    dump.stdout.pipe(gz.stdin);
    // gzip stdout → file
    gz.stdout.pipe(out);

    const stderrChunks = [];
    dump.stderr.on("data", (d) => stderrChunks.push(d));
    gz.stderr.on("data", (d) => stderrChunks.push(d));

    let dumpCode = null;
    let gzCode   = null;

    function checkDone() {
      if (dumpCode === null || gzCode === null) return;
      if (dumpCode !== 0 || gzCode !== 0) {
        const errText = Buffer.concat(stderrChunks).toString().trim();
        reject(new Error(`pg_dump (exit ${dumpCode}) | gzip (exit ${gzCode}): ${errText}`));
      } else {
        resolve();
      }
    }

    dump.on("close", (code) => { dumpCode = code; checkDone(); });
    gz.on("close",   (code) => { gzCode   = code; checkDone(); });
    out.on("error",  reject);
  });
}

/**
 * Upload a local file to S3 via the AWS CLI (aws s3 cp).
 * Requires aws CLI to be installed and credentials configured (IAM role or
 * AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars).
 */
async function uploadToS3(localFile, s3Key) {
  const s3Uri = `s3://${S3_BUCKET}/${s3Key}`;
  log(`Uploading to ${s3Uri} …`);
  await execFileAsync("aws", ["s3", "cp", localFile, s3Uri, "--quiet"]);
  log(`Uploaded to ${s3Uri}`);
}

/**
 * Keep only the most recent KEEP_LAST_N platform backup files; delete older ones.
 */
function pruneOldBackups() {
  let files;
  try {
    files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => /^platform-\d{4}-\d{2}-\d{2}\.sql\.gz$/.test(f))
      .sort() // ISO dates sort lexicographically
      .reverse(); // newest first
  } catch {
    return; // directory not readable — not fatal
  }

  const toDelete = files.slice(KEEP_LAST_N);
  for (const f of toDelete) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
      log(`Pruned old backup: ${f}`);
    } catch (err) {
      logErr(`Could not delete old backup ${f}`, err);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  log(`=== EPiC Platform DB Backup START — DB: ${DB_NAME} on ${DB_HOST}:${DB_PORT} ===`);

  // Ensure backup directory exists
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp    = todayStamp();
  const filename = `platform-${stamp}.sql.gz`;
  const outFile  = path.join(BACKUP_DIR, filename);

  // 1. Dump
  log(`Running pg_dump → ${outFile}`);
  await runPgDump(outFile);

  const stat = fs.statSync(outFile);
  const sizeMb = (stat.size / 1024 / 1024).toFixed(2);
  log(`Backup written: ${filename} (${sizeMb} MB)`);

  // 2. S3 upload (optional)
  if (S3_BUCKET) {
    const s3Key = `${S3_PREFIX}/${filename}`;
    try {
      await uploadToS3(outFile, s3Key);
    } catch (err) {
      // Log but do not abort — local backup is still valid
      logErr("S3 upload failed (local backup retained)", err);
    }
  } else {
    log("AWS_S3_BACKUP_BUCKET not set — skipping S3 upload");
  }

  // 3. Prune old local backups
  pruneOldBackups();
  log(`Local retention: keeping last ${KEEP_LAST_N} backups`);

  log(`=== EPiC Platform DB Backup COMPLETE ===`);
  return { filename, sizeMb: parseFloat(sizeMb) };
}

// Allow import as a module (called from the cron job) or direct invocation
export { main as runBackup };

// Direct invocation: node scripts/backup.js
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
    .then(({ filename, sizeMb }) => {
      console.log(`\nDone: ${filename} (${sizeMb} MB)`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("\nBackup FAILED:", err.message);
      process.exit(1);
    });
}
