/**
 * dailyBackup.job.js — Daily database backup cron job.
 *
 * Schedule : 02:00 IST (Asia/Kolkata) every day — runs after GDPR retention
 *            (03:00) is taken, chosen here for a quieter window before other
 *            jobs wake up. Adjust BACKUP_SCHEDULE if needed.
 *
 * What it does:
 *   1. Spawns scripts/backup.js as a child process so the pg_dump pipe runs
 *      in its own OS process and cannot block the Node event loop.
 *   2. Captures stdout/stderr and surfaces them through the shared logger so
 *      pm2 logs api | grep '"name":"cron:daily-backup"' shows everything.
 *   3. On failure it sends an alert email to the platform admin address
 *      (BACKUP_ALERT_EMAIL env var, falls back to EMAIL_USER) using the
 *      existing sendMail helper.
 *
 * This function is NOT called directly — it is registered via the JOBS array
 * in src/jobs/index.js alongside all other scheduled jobs.
 *
 * Env vars:
 *   BACKUP_ALERT_EMAIL  — recipient for failure alerts (defaults to EMAIL_USER)
 *   (All DB / S3 vars are consumed by scripts/backup.js — see that file.)
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../utils/logger.js";
import { sendMail } from "../services/email.service.js";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
// jobs/ → src/ → Server/ → scripts/backup.js
const BACKUP_SCRIPT = path.resolve(__dirname, "../../scripts/backup.js");

/**
 * Run backup.js in a child process.
 * Resolves with { ok, durationMs, stdout, stderr, exitCode }.
 */
function spawnBackup() {
  return new Promise((resolve) => {
    const t0      = Date.now();
    const stdoutChunks = [];
    const stderrChunks = [];

    // Use the same node binary that is running the server
    const child = spawn(process.execPath, [BACKUP_SCRIPT], {
      env:   process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (d) => stdoutChunks.push(d));
    child.stderr.on("data", (d) => stderrChunks.push(d));

    child.on("close", (exitCode) => {
      resolve({
        ok:          exitCode === 0,
        exitCode,
        durationMs:  Date.now() - t0,
        stdout:      Buffer.concat(stdoutChunks).toString().trim(),
        stderr:      Buffer.concat(stderrChunks).toString().trim(),
      });
    });

    child.on("error", (err) => {
      resolve({
        ok:         false,
        exitCode:   -1,
        durationMs: Date.now() - t0,
        stdout:     "",
        stderr:     err.message,
      });
    });
  });
}

/**
 * Send a plain-text failure alert to the configured admin email.
 * Swallows errors so a mail failure doesn't mask the backup failure.
 */
async function sendBackupFailureAlert({ exitCode, stderr, durationMs }) {
  const to = (process.env.BACKUP_ALERT_EMAIL || process.env.EMAIL_USER || "").trim();
  if (!to) {
    logger.warn("[cron:daily-backup] BACKUP_ALERT_EMAIL not set — cannot send failure alert");
    return;
  }

  const subject = `[EPiC] Daily database backup FAILED — ${new Date().toISOString().slice(0, 10)}`;
  const text = [
    "The automated daily database backup job failed.",
    "",
    `  Exit code  : ${exitCode}`,
    `  Duration   : ${durationMs} ms`,
    `  Error      : ${stderr || "(no stderr output)"}`,
    "",
    "Action required:",
    "  1. SSH to the server and run scripts/backup.js manually to confirm the issue.",
    "  2. Check pg_dump connectivity: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD.",
    "  3. Check available disk space: df -h /var/backups/epic",
    "  4. Review pm2 logs for additional context:",
    "       pm2 logs api --raw | grep 'cron:daily-backup'",
  ].join("\n");

  try {
    await sendMail({ to, subject, text });
    logger.info({ to }, "[cron:daily-backup] failure alert email sent");
  } catch (err) {
    logger.error({ err }, "[cron:daily-backup] could not send failure alert email");
  }
}

/**
 * Main job function — called by the cron scheduler in index.js.
 * Must return an object (spread into the completion log entry).
 */
export async function runDailyBackup() {
  logger.info("[cron:daily-backup] spawning backup script");

  const result = await spawnBackup();

  // Surface backup script output through structured logs
  if (result.stdout) {
    logger.info({ script: "backup.js" }, result.stdout);
  }
  if (result.stderr) {
    logger.warn({ script: "backup.js" }, result.stderr);
  }

  if (!result.ok) {
    logger.error(
      { exitCode: result.exitCode, durationMs: result.durationMs },
      "[cron:daily-backup] backup script exited with non-zero code"
    );
    await sendBackupFailureAlert(result);
    // Throw so the outer job runner logs it as an uncaught error and records durationMs
    throw new Error(`backup.js exited ${result.exitCode}: ${result.stderr || "see logs"}`);
  }

  return {
    exitCode:   result.exitCode,
    durationMs: result.durationMs,
  };
}
