import crypto from "crypto";
import fetch from "node-fetch";
import platformDb from "../models/index.js";
import logger from "../utils/logger.js";

const MAX_RETRIES = 4;
const RETRY_DELAYS_MS = [0, 30_000, 300_000, 3_600_000]; // immediate, 30s, 5m, 1h

export const WEBHOOK_EVENTS = {
  CASE_CREATED: "case.created",
  CASE_UPDATED: "case.updated",
  CASE_CLOSED: "case.closed",
  PAYMENT_RECEIVED: "payment.received",
  PAYMENT_FAILED: "payment.failed",
  WORKER_REGISTERED: "worker.registered",
  WORKER_COS_ASSIGNED: "worker.cos_assigned",
  VISA_EXPIRY_ALERT: "visa.expiry_alert",
  STATUS_CHANGED: "status.changed",
  DOCUMENT_UPLOADED: "document.uploaded",
};

function signPayload(secret, payload) {
  const ts = Date.now();
  const body = `${ts}.${JSON.stringify(payload)}`;
  const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return { timestamp: ts, signature: `t=${ts},v1=${sig}` };
}

async function deliverToEndpoint(endpoint, eventType, payload, logId) {
  const { timestamp, signature } = signPayload(endpoint.secret, payload);

  let responseStatus = null;
  let responseBody = null;

  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-EPiC-Event": eventType,
        "X-EPiC-Signature": signature,
        "X-EPiC-Timestamp": String(timestamp),
        "User-Agent": "EPiC-Webhooks/1.0",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    responseStatus = res.status;
    responseBody = await res.text().catch(() => null);

    if (res.ok) {
      await platformDb.WebhookDeliveryLog.update(
        { status: "delivered", response_status: responseStatus, response_body: responseBody, delivered_at: new Date() },
        { where: { id: logId } }
      );
      return true;
    }
  } catch (err) {
    responseBody = err.message;
    logger.warn({ err, endpointId: endpoint.id, eventType }, "Webhook delivery attempt failed");
  }

  return false;
}

/**
 * Dispatch a webhook event to all active endpoints for an organisation.
 * Runs asynchronously — does not block the caller.
 */
export async function dispatchWebhookEvent(organisationId, eventType, data) {
  try {
    const endpoints = await platformDb.WebhookEndpoint.findAll({
      where: { organisation_id: organisationId, is_active: true },
    });

    const subscribed = endpoints.filter(
      (ep) => ep.events.length === 0 || ep.events.includes(eventType) || ep.events.includes("*")
    );

    for (const endpoint of subscribed) {
      const payload = {
        id: crypto.randomUUID(),
        event: eventType,
        organisation_id: organisationId,
        timestamp: new Date().toISOString(),
        data,
      };

      const log = await platformDb.WebhookDeliveryLog.create({
        webhook_endpoint_id: endpoint.id,
        event_type: eventType,
        payload,
        status: "pending",
        attempt_count: 0,
      });

      // Attempt delivery immediately
      const ok = await deliverToEndpoint(endpoint, eventType, payload, log.id);
      if (!ok) {
        await platformDb.WebhookDeliveryLog.update(
          {
            status: "retrying",
            attempt_count: 1,
            next_retry_at: new Date(Date.now() + RETRY_DELAYS_MS[1]),
          },
          { where: { id: log.id } }
        );
      }
    }
  } catch (err) {
    logger.error({ err, organisationId, eventType }, "dispatchWebhookEvent error");
  }
}

/**
 * Retry failed webhook deliveries — called by a scheduled job.
 */
export async function retryFailedWebhooks() {
  const now = new Date();
  const pending = await platformDb.WebhookDeliveryLog.findAll({
    where: { status: "retrying" },
    include: [{ model: platformDb.WebhookEndpoint, as: "endpoint" }],
  }).catch(() => []);

  for (const log of pending) {
    if (!log.endpoint?.is_active) continue;
    if (log.next_retry_at && new Date(log.next_retry_at) > now) continue;

    const ok = await deliverToEndpoint(log.endpoint, log.event_type, log.payload, log.id);
    const nextAttempt = (log.attempt_count || 0) + 1;

    if (!ok) {
      if (nextAttempt >= MAX_RETRIES) {
        await log.update({ status: "failed", attempt_count: nextAttempt });
      } else {
        await log.update({
          attempt_count: nextAttempt,
          next_retry_at: new Date(Date.now() + (RETRY_DELAYS_MS[nextAttempt] || 3_600_000)),
        });
      }
    }
  }
}
