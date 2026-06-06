import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import express from "express";

// node:test module mocking (run with --experimental-test-module-mocks; see package.json).
// Mock the Stripe tenant service + platform DB BEFORE importing the controller.
const stripeSvc = {
  toPublicAssetUrl: mock.fn(),
  getTenantPaymentSettings: mock.fn(async () => ({})),
  createStripeClient: mock.fn(),
  getStripeForTenant: mock.fn(async () => ({})),
  getPlatformPaymentSettings: mock.fn(async () => ({})),
  getStripeForRequest: mock.fn(async () => ({ stripe: {}, settings: {} })),
  buildStripeMetadata: mock.fn(() => ({})),
  resolveTenantDbByOrganisationId: mock.fn(async () => null),
  resolveTenantDbFromStripeObject: mock.fn(async () => ({ tenantDb: null, organisationId: 1 })),
  constructStripeWebhookEvent: mock.fn(async () => ({ id: "evt", type: "customer.created" })),
  syncSubscriptionToCandidate: mock.fn(async () => {}),
  notifyCandidatePaymentEvent: mock.fn(async () => {}),
};
const platformDb = {
  StripeWebhookEvent: { findOne: mock.fn(async () => null), create: mock.fn(async () => ({ save: mock.fn() })) },
  PaymentWebhookRetryQueue: { create: mock.fn(async () => ({})) },
};

mock.module("../src/services/stripeTenant.service.js", { namedExports: stripeSvc });
mock.module("../src/models/index.js", { defaultExport: platformDb });

const { handleWebhook } = await import("../src/modules/Candidate/Payments/stripepayment.controller.js");

const app = express();
app.post("/webhook", express.raw({ type: "application/json" }), handleWebhook);

const post = (event, sig = "valid-sig") =>
  request(app).post("/webhook").set("stripe-signature", sig).send(Buffer.from(JSON.stringify(event)));

describe("Stripe Webhook Controller", () => {
  beforeEach(() => {
    for (const fn of Object.values(stripeSvc)) fn.mock.resetCalls();
    platformDb.StripeWebhookEvent.findOne.mock.resetCalls();
    platformDb.StripeWebhookEvent.create.mock.resetCalls();
    platformDb.PaymentWebhookRetryQueue.create.mock.resetCalls();
    // restore default implementations
    stripeSvc.constructStripeWebhookEvent.mock.mockImplementation(async () => ({ id: "evt", type: "customer.created" }));
    stripeSvc.resolveTenantDbFromStripeObject.mock.mockImplementation(async () => ({ tenantDb: null, organisationId: 1 }));
    platformDb.StripeWebhookEvent.findOne.mock.mockImplementation(async () => null);
    platformDb.StripeWebhookEvent.create.mock.mockImplementation(async () => ({ save: mock.fn() }));
    platformDb.PaymentWebhookRetryQueue.create.mock.mockImplementation(async () => ({}));
  });

  it("returns 400 if signature verification fails", async () => {
    stripeSvc.constructStripeWebhookEvent.mock.mockImplementationOnce(() =>
      Promise.reject(new Error("Invalid signature")),
    );
    const res = await post({ type: "customer.created" }, "invalid-sig");
    assert.equal(res.status, 400);
    assert.ok(res.text.includes("Webhook Error: Invalid signature"));
  });

  it("ignores duplicate webhooks for idempotency", async () => {
    const event = { id: "evt_duplicate123", type: "customer.created" };
    stripeSvc.constructStripeWebhookEvent.mock.mockImplementationOnce(async () => event);
    platformDb.StripeWebhookEvent.findOne.mock.mockImplementationOnce(async () => ({ id: 1, event_id: event.id }));

    const res = await post(event);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { received: true, duplicate: true });
    assert.equal(platformDb.StripeWebhookEvent.create.mock.calls.length, 0);
  });

  it("pushes to the retry queue if processing fails (always 200 to Stripe)", async () => {
    const event = {
      id: "evt_fail456",
      type: "charge.refunded",
      data: { object: { metadata: { userId: "1" }, amount_refunded: 5000, id: "ch_123" } },
    };
    stripeSvc.constructStripeWebhookEvent.mock.mockImplementationOnce(async () => event);
    platformDb.StripeWebhookEvent.findOne.mock.mockImplementationOnce(async () => null);

    const record = { save: mock.fn() };
    platformDb.StripeWebhookEvent.create.mock.mockImplementationOnce(async () => record);

    // Force a failure deep inside processing.
    const tenantDb = {
      AuditLog: { create: mock.fn(() => Promise.reject(new Error("DB Connection Failed"))) },
    };
    stripeSvc.resolveTenantDbFromStripeObject.mock.mockImplementationOnce(async () => ({ tenantDb, organisationId: 1 }));

    const res = await post(event);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { received: true, queued_for_retry: true });
    assert.equal(record.processing_status, "failed");

    const call = platformDb.PaymentWebhookRetryQueue.create.mock.calls[0];
    assert.ok(call, "retry queue create should have been called");
    assert.equal(call.arguments[0].event_id, "evt_fail456");
    assert.equal(call.arguments[0].error_reason, "DB Connection Failed");
  });
});
