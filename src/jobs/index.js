/**
 * Scheduled Jobs â€” EPiC Platform
 *
 * Replaces the raw setInterval calls in server.js with proper cron expressions
 * (node-cron), timezone-aware scheduling, and structured health logging.
 *
 * All times are IST (Asia/Kolkata, UTC+5:30) â€” node-cron schedules are fired
 * using the `timezone` option so the server TZ variable is not a dependency.
 *
 * â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
 * â”‚  Job                          Schedule        Description               â”‚
 * â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
 * â”‚  licence-notifications        08:00 daily     Expiry reminders + SLA    â”‚
 * â”‚  compliance-alerts            09:00 daily     Visa / RTW / worker evts  â”‚
 * â”‚  subscription-expiry          every 6 h       Suspend lapsed orgs       â”‚
 * â”‚  daily-backup                 02:00 daily     pg_dump platform DB â†’ gz  â”‚
 * â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
 *
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * MONITORING STRATEGY
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * 1. Structured logging (pino)
 *    Every job emits:
 *      â€¢ "[cron:<name>]: starting"  on fire
 *      â€¢ "[cron:<name>]: completed" with { durationMs, ...counts } on success
 *      â€¢ "[cron:<name>]: uncaught error" with full err on crash
 *    Filter live:  pm2 logs --raw | grep '"name":"cron'
 *    Or tail JSON: pm2 logs api --json | jq 'select(.msg | contains("cron"))'
 *
 * 2. PM2 process monitor
 *    pm2 monit                        â€” realtime CPU/mem + last 50 log lines
 *    pm2 status                       â€” uptime, restart count, memory
 *    Set up pm2 save + startup so jobs survive reboots:
 *      pm2 save && pm2 startup
 *
 * 3. Error alerting (recommended additions)
 *    a) PM2 + pm2-notify-slack (npm i -g pm2-notify-slack) â€” Slack alert on
 *       process restart / memory threshold breach.
 *    b) Sentry (npm i @sentry/node) â€” wrap each job fn in Sentry.withScope()
 *       to capture uncaught job errors with full context.
 *    c) Uptime monitoring: expose GET /health/jobs that returns the last-run
 *       summary from processScheduledNotifications(); use Uptime Robot or
 *       Freshping to poll every 5 min and alert on non-200.
 *
 * 4. Database audit trail
 *    Every notification event writes to `audit_logs` (tenant DB) with:
 *      action: LICENCE_EXPIRY_REMINDER_<N>D | LICENCE_SLA_BREACH_<N>D
 *    Query yesterday's runs:
 *      SELECT action, COUNT(*) FROM audit_logs
 *      WHERE created_at >= NOW() - INTERVAL '1 day'
 *        AND action LIKE 'LICENCE_%'
 *      GROUP BY action;
 *
 * 5. Key metrics to track
 *    - licenceExpiry.remindersSent   (expected: 0â€“5 on most days)
 *    - licenceSla.breachesDetected   (SLA health indicator â€” target: 0)
 *    - durationMs                    (alert if > 30 000ms = job is slow)
 *    - orgsProcessed                 (cross-check with Organisation count)
 *
 * 6. Manual trigger (admin CLI)
 *    node -e "import('./src/services/licenceScheduled.service.js')
 *      .then(m => m.processScheduledNotifications())
 *      .then(console.log)"
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 */

import cron from "node-cron";
import { processScheduledNotifications } from "../services/licenceScheduled.service.js";
import { runComplianceAlerts } from "../services/complianceAlerts.service.js";
import { checkAndExpireSubscriptions } from "../services/subscriptionExpiry.service.js";
import { enforceRetentionPolicy } from "../services/gdpr.service.js";
import { runAuditRetention } from "../services/auditRetentionRunner.service.js";
import { sendTrialDripEmails } from "../services/onboardingEmail.service.js";
import { resetSandboxEnvironments } from "../services/sandbox.service.js";
import { runDailyBackup } from "./dailyBackup.job.js";
import { runInformationRequestedReminders } from "./reminder.job.js";
import { runMonthlyComplianceReviewJob } from "./monthlyComplianceReview.job.js";
import logger from "../utils/logger.js";

const TZ = "Asia/Kolkata";

/** Job registry â€” single source of truth for all scheduled work. */
const JOBS = [
  {
    name:        "licence-notifications",
    schedule:    "0 8 * * *",   // 08:00 IST daily
    description: "Licence expiry reminders (90/60/30/14d) + SLA breach detector (5/10/15d)",
    fn:          processScheduledNotifications,
  },
  {
    name:        "compliance-alerts",
    schedule:    "0 9 * * *",   // 09:00 IST daily
    description: "Visa expiry, right-to-work follow-ups, worker event deadlines",
    fn:          runComplianceAlerts,
  },
  {
    name:        "subscription-expiry",
    schedule:    "0 */6 * * *", // every 6 hours
    description: "Suspend organisations whose subscription has lapsed",
    fn:          checkAndExpireSubscriptions,
  },
  {
    name:        "gdpr-retention",
    schedule:    "0 3 * * *",   // 03:00 IST daily
    description: "GDPR data retention: hard-delete records older than retention period for suspended orgs",
    fn:          enforceRetentionPolicy,
  },
  {
    name:        "audit-retention",
    schedule:    "0 3 * * 0",   // 03:00 IST every Sunday (weekly, not daily — less I/O)
    description: "Purge licence_application_audits and compliance_review_history rows older than 730 days across all active/trial tenant DBs",
    fn:          runAuditRetention,
  },
  {
    name:        "trial-drip-emails",
    schedule:    "0 10 * * *",  // 10:00 IST daily
    description: "Send trial reminder emails: Day 7 reminder, Day 14 expiry, conversion nudge",
    fn:          sendTrialDripEmails,
  },
  {
    name:        "sandbox-reset",
    schedule:    "0 0 * * *",   // midnight IST daily
    description: "Reset sandbox/demo tenant environments (pre-populated, auto-reset every 24h)",
    fn:          resetSandboxEnvironments,
  },
  {
    name:        "daily-backup",
    schedule:    "0 2 * * *",   // 02:00 IST daily
    description: "pg_dump platform DB → ./backups/platform-YYYY-MM-DD.sql.gz; optional S3 upload; alerts on failure",
    fn:          runDailyBackup,
  },

  {
    name:        "information-requested-reminders",
    schedule:    "30 10 * * *", // 10:30 IST daily (after compliance-alerts at 09:00)
    description: "Chaser email + audit log for compliance items with no sponsor response in 3+ working days",
    fn:          runInformationRequestedReminders,
  },
  {
    name:        "monthly-compliance-review",
    schedule:    "0 8 1 * *",   // 08:00 IST on the 1st of every month (Section N)
    description: "Generate monthly compliance review: 5-section frozen report (Summary, Expiring, History, Missing Docs, Risk Movement) + email to Sponsor / Caseworkers / Admins",
    fn:          runMonthlyComplianceReviewJob,
  },
];

let _started = false;

/**
 * Register all scheduled jobs with node-cron.
 * Safe to call once at server startup â€” subsequent calls are no-ops.
 */
export function startScheduledJobs() {
  if (_started) {
    logger.warn("startScheduledJobs: already running â€” skipping duplicate registration");
    return;
  }
  _started = true;

  for (const job of JOBS) {
    if (!cron.validate(job.schedule)) {
      logger.error({ schedule: job.schedule, name: job.name }, "Invalid cron expression â€” job NOT registered");
      continue;
    }

    cron.schedule(
      job.schedule,
      async () => {
        const label = `[cron:${job.name}]`;
        const t0 = Date.now();
        logger.info({ name: job.name }, `${label}: starting`);
        try {
          const result = await job.fn();
          logger.info({ name: job.name, durationMs: Date.now() - t0, ...result }, `${label}: completed`);
        } catch (err) {
          logger.error({ err, name: job.name, durationMs: Date.now() - t0 }, `${label}: uncaught error`);
        }
      },
      { timezone: TZ },
    );

    logger.info({ name: job.name, schedule: job.schedule, description: job.description }, "Scheduled job registered");
  }

  logger.info({ jobCount: JOBS.length, timezone: TZ }, "All scheduled jobs active");
}

/** List registered jobs (for /health/jobs endpoint). */
export function listScheduledJobs() {
  return JOBS.map(({ name, schedule, description }) => ({ name, schedule, description }));
}
