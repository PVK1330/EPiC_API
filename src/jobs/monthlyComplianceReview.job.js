/**
 * Monthly Compliance Review Job — Section N
 *
 * Fires on the 1st of every month at 08:00 IST.
 * Iterates every active tenant organisation, generates a per-sponsor frozen
 * compliance report (five sections), persists it to
 * `monthly_compliance_reviews`, and sends digest emails to:
 *   • each sponsor (BUSINESS role user)
 *   • all caseworkers in that tenant
 *   • all admins in that tenant
 *
 * Registered in jobs/index.js alongside the other platform cron jobs.
 * Can also be invoked on-demand via the manual trigger controller.
 */

import { runMonthlyComplianceReview } from "../services/monthlyComplianceReport.service.js";
import logger from "../utils/logger.js";

/**
 * Entry-point consumed by the cron scheduler in jobs/index.js.
 * Returns a summary object so the scheduler can log structured metrics.
 */
export async function runMonthlyComplianceReviewJob() {
  const label = "[cron:monthly-compliance-review]";
  logger.info(label + " starting");

  const t0 = Date.now();
  try {
    const result = await runMonthlyComplianceReview();
    const durationMs = Date.now() - t0;
    logger.info({ ...result, durationMs }, label + " completed");
    return result;
  } catch (err) {
    const durationMs = Date.now() - t0;
    logger.error({ err, durationMs }, label + " uncaught error");
    throw err;
  }
}
