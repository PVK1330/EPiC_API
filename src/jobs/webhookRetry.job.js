/**
 * Webhook retry job — runs every 5 minutes.
 * Retries failed webhook deliveries with exponential backoff.
 * Week 9 Task 2.
 */
import { retryFailedWebhooks } from "../services/webhook.service.js";
import logger from "../utils/logger.js";

let retryInterval = null;

export function startWebhookRetryJob(intervalMs = 5 * 60 * 1000) {
  if (retryInterval) return;
  retryInterval = setInterval(async () => {
    try {
      await retryFailedWebhooks();
    } catch (err) {
      logger.error({ err }, "webhookRetryJob error");
    }
  }, intervalMs);
  logger.info(`Webhook retry job started (interval: ${intervalMs / 1000}s)`);
}

export function stopWebhookRetryJob() {
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
  }
}
