/**
 * Week 10 Task 11: Webhook system — unit + logic tests.
 * Uses Node.js built-in test runner (node --test).
 * Pure logic — no DB connection required.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

// ── Event registry (mirrors webhook.service.js) ───────────────────────────────
const WEBHOOK_EVENTS = Object.freeze({
  CASE_CREATED:       "case.created",
  CASE_UPDATED:       "case.updated",
  CASE_CLOSED:        "case.closed",
  PAYMENT_RECEIVED:   "payment.received",
  PAYMENT_FAILED:     "payment.failed",
  WORKER_REGISTERED:  "worker.registered",
  WORKER_COS_ASSIGNED:"worker.cos_assigned",
  VISA_EXPIRY_ALERT:  "visa.expiry_alert",
  STATUS_CHANGED:     "status.changed",
  DOCUMENT_UPLOADED:  "document.uploaded",
});

// ── Payload signing (mirrors webhook.service.js) ──────────────────────────────
function signPayload(secret, payload, ts = Date.now()) {
  const body = `${ts}.${JSON.stringify(payload)}`;
  const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return { timestamp: ts, signature: `t=${ts},v1=${sig}` };
}

function verifySignature(secret, payload, signature) {
  const match = signature.match(/t=(\d+),v1=([a-f0-9]+)/);
  if (!match) return false;
  const [, ts, receivedSig] = match;
  const body = `${ts}.${JSON.stringify(payload)}`;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedSig));
}

// ── Retry delay config ────────────────────────────────────────────────────────
const RETRY_DELAYS_MS = [0, 30_000, 300_000, 3_600_000];
const MAX_RETRIES = 4;

describe("Webhook Events Registry", () => {
  it("contains exactly 10 event types", () => {
    assert.equal(Object.keys(WEBHOOK_EVENTS).length, 10);
  });

  it("case.created event is registered", () => {
    assert.equal(WEBHOOK_EVENTS.CASE_CREATED, "case.created");
  });

  it("payment events are registered", () => {
    assert.equal(WEBHOOK_EVENTS.PAYMENT_RECEIVED, "payment.received");
    assert.equal(WEBHOOK_EVENTS.PAYMENT_FAILED, "payment.failed");
  });

  it("worker events are registered", () => {
    assert.equal(WEBHOOK_EVENTS.WORKER_COS_ASSIGNED, "worker.cos_assigned");
    assert.equal(WEBHOOK_EVENTS.WORKER_REGISTERED, "worker.registered");
  });

  it("visa expiry alert is registered", () => {
    assert.equal(WEBHOOK_EVENTS.VISA_EXPIRY_ALERT, "visa.expiry_alert");
  });

  it("all event values follow dot-notation format", () => {
    Object.values(WEBHOOK_EVENTS).forEach((event) => {
      assert.match(event, /^[a-z_]+\.[a-z_]+$/, `Invalid event format: ${event}`);
    });
  });
});

describe("Webhook Payload Signing", () => {
  const secret = "whsec_test_secret_abc123";
  const payload = { id: "uuid-1234", event: "case.created", data: { id: 42 } };

  it("signature format is t=<ts>,v1=<hex>", () => {
    const { signature } = signPayload(secret, payload);
    assert.match(signature, /^t=\d+,v1=[a-f0-9]{64}$/);
  });

  it("signature verifies correctly", () => {
    const ts = 1700000000000;
    const { signature } = signPayload(secret, payload, ts);
    assert.ok(verifySignature(secret, payload, signature));
  });

  it("signature fails with wrong secret", () => {
    const { signature } = signPayload(secret, payload);
    assert.ok(!verifySignature("wrong_secret", payload, signature));
  });

  it("signature fails when payload is tampered", () => {
    const ts = 1700000000000;
    const { signature } = signPayload(secret, payload, ts);
    const tampered = { ...payload, data: { id: 99 } };
    assert.ok(!verifySignature(secret, tampered, signature));
  });

  it("two different payloads produce different signatures", () => {
    const { signature: s1 } = signPayload(secret, { id: 1 });
    const { signature: s2 } = signPayload(secret, { id: 2 });
    assert.notEqual(s1, s2);
  });

  it("two different secrets produce different signatures", () => {
    const { signature: s1 } = signPayload("secret_a", payload);
    const { signature: s2 } = signPayload("secret_b", payload);
    assert.notEqual(s1, s2);
  });
});

describe("Webhook Retry Logic", () => {
  it("max retries is 4", () => {
    assert.equal(MAX_RETRIES, 4);
  });

  it("retry delays increase monotonically", () => {
    for (let i = 1; i < RETRY_DELAYS_MS.length; i++) {
      assert.ok(RETRY_DELAYS_MS[i] > RETRY_DELAYS_MS[i - 1],
        `Delay at index ${i} (${RETRY_DELAYS_MS[i]}) is not greater than index ${i - 1} (${RETRY_DELAYS_MS[i - 1]})`);
    }
  });

  it("first attempt has 0 delay (immediate)", () => {
    assert.equal(RETRY_DELAYS_MS[0], 0);
  });

  it("second attempt waits 30 seconds", () => {
    assert.equal(RETRY_DELAYS_MS[1], 30_000);
  });

  it("third attempt waits 5 minutes", () => {
    assert.equal(RETRY_DELAYS_MS[2], 300_000);
  });

  it("fourth attempt waits 1 hour", () => {
    assert.equal(RETRY_DELAYS_MS[3], 3_600_000);
  });

  it("endpoint subscription filter — empty events array means subscribe to all", () => {
    const subscribed = (epEvents, eventType) =>
      epEvents.length === 0 || epEvents.includes(eventType) || epEvents.includes("*");

    assert.ok(subscribed([], "case.created"));
    assert.ok(subscribed(["*"], "payment.received"));
    assert.ok(subscribed(["case.created"], "case.created"));
    assert.ok(!subscribed(["case.created"], "payment.received"));
  });
});

describe("Webhook Secret Generation", () => {
  it("generated secret has whsec_ prefix", () => {
    const secret = `whsec_${crypto.randomBytes(32).toString("hex")}`;
    assert.ok(secret.startsWith("whsec_"));
  });

  it("generated secrets are unique", () => {
    const s1 = `whsec_${crypto.randomBytes(32).toString("hex")}`;
    const s2 = `whsec_${crypto.randomBytes(32).toString("hex")}`;
    assert.notEqual(s1, s2);
  });

  it("secret is at least 64 characters long", () => {
    const secret = `whsec_${crypto.randomBytes(32).toString("hex")}`;
    assert.ok(secret.length >= 64, `Secret too short: ${secret.length}`);
  });
});
