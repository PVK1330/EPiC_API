import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// Mock the Stripe tenant service BEFORE importing the controller. Everything
// else the controller imports (logger, dateHelpers, tenantScope) is pure and
// used as-is. We drive the tenant DB through a hand-rolled fake req.tenantDb.
const stripeSvc = {
  getStripeForRequest: mock.fn(async () => ({
    stripe: {
      checkout: {
        sessions: {
          create: mock.fn(async () => ({ id: "cs_test_1", url: "https://stripe.test/checkout/cs_test_1" })),
          retrieve: mock.fn(async () => ({})),
        },
      },
      paymentIntents: { retrieve: mock.fn(async () => ({})) },
    },
    settings: { stripe_secret_key: "sk_test_123" },
  })),
  buildStripeMetadata: mock.fn((req, extra = {}) => ({
    organisationId: String(req?.user?.organisation_id ?? ""),
    ...extra,
  })),
};

mock.module("../src/services/stripeTenant.service.js", { namedExports: stripeSvc });

const { createSponsorCheckoutSession, verifySponsorCheckoutSession, computeSponsorPayables } = await import(
  "../src/modules/Sponsor/Payments/sponsorPayment.controller.js"
);

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

const USER_ID = 42;
const ORG_ID = 3;

/** Build a fake tenantDb with just the model methods the controller touches. */
function makeTenantDb(overrides = {}) {
  return {
    LicenceApplication: {
      findOne: mock.fn(async () => null),
      findAll: mock.fn(async () => []),
    },
    SponsorPayment: {
      findOne: mock.fn(async () => null),
      findAll: mock.fn(async () => []),
      create: mock.fn(async (row) => ({ id: 1, ...row })),
    },
    Case: {
      findOne: mock.fn(async () => null),
      findAll: mock.fn(async () => []),
    },
    CasePayment: { findOne: mock.fn(async () => null), create: mock.fn(async () => ({})) },
    sequelize: { transaction: mock.fn(async (fn) => fn({ LOCK: { UPDATE: "UPDATE" } })) },
    ...overrides,
  };
}

const makeReq = (tenantDb, body = {}, params = {}) => ({
  user: { userId: USER_ID, organisation_id: ORG_ID },
  tenantDb,
  body,
  params,
});

describe("Sponsor Payments — checkout", () => {
  beforeEach(() => {
    for (const fn of Object.values(stripeSvc)) fn.mock.resetCalls();
    stripeSvc.getStripeForRequest.mock.mockImplementation(async () => ({
      stripe: {
        checkout: {
          sessions: {
            create: mock.fn(async () => ({ id: "cs_test_1", url: "https://stripe.test/checkout/cs_test_1" })),
            retrieve: mock.fn(async () => ({})),
          },
        },
        paymentIntents: { retrieve: mock.fn(async () => ({})) },
      },
      settings: { stripe_secret_key: "sk_test_123" },
    }));
  });

  it("returns 503 when the tenant has no Stripe secret key", async () => {
    stripeSvc.getStripeForRequest.mock.mockImplementationOnce(async () => ({
      stripe: {},
      settings: { stripe_secret_key: null },
    }));
    const tenantDb = makeTenantDb();
    const req = makeReq(tenantDb, { payableType: "licence_fee", payableRef: 7 });
    const res = mockRes();
    await createSponsorCheckoutSession(req, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.message, /not configured/i);
  });

  it("creates a Checkout session + a pending ledger row for a licence fee", async () => {
    const tenantDb = makeTenantDb({
      LicenceApplication: {
        findOne: mock.fn(async () => ({
          id: 7,
          userId: USER_ID,
          feeTotal: 574,
          feeIscEstimate: 0,
          feeCurrency: "GBP",
          companyName: "Acme Ltd",
        })),
        findAll: mock.fn(async () => []),
      },
    });
    const req = makeReq(tenantDb, { payableType: "licence_fee", payableRef: 7 });
    const res = mockRes();
    await createSponsorCheckoutSession(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.url, "https://stripe.test/checkout/cs_test_1");
    assert.equal(res.body.data.amount, 574);
    // A pending sponsor_payments row keyed to the session id must be recorded.
    assert.equal(tenantDb.SponsorPayment.create.mock.calls.length, 1);
    const created = tenantDb.SponsorPayment.create.mock.calls[0].arguments[0];
    assert.equal(created.status, "pending");
    assert.equal(created.payableType, "licence_fee");
    assert.equal(created.stripeSessionId, "cs_test_1");
  });

  it("rejects an already-paid licence fee with 409", async () => {
    const tenantDb = makeTenantDb({
      LicenceApplication: {
        findOne: mock.fn(async () => ({ id: 7, userId: USER_ID, feeTotal: 574, feeCurrency: "GBP" })),
        findAll: mock.fn(async () => []),
      },
      SponsorPayment: {
        findOne: mock.fn(async () => ({ id: 99, status: "completed" })),
        findAll: mock.fn(async () => []),
        create: mock.fn(async () => ({})),
      },
    });
    const req = makeReq(tenantDb, { payableType: "licence_fee", payableRef: 7 });
    const res = mockRes();
    await createSponsorCheckoutSession(req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(tenantDb.SponsorPayment.create.mock.calls.length, 0);
  });

  it("does NOT write a sponsor_payments row for a case fee (case_payments is its ledger)", async () => {
    const tenantDb = makeTenantDb({
      Case: {
        findOne: mock.fn(async () => ({ id: 5, caseId: "C-5", totalAmount: 1000, paidAmount: 200 })),
        findAll: mock.fn(async () => []),
      },
    });
    const req = makeReq(tenantDb, { payableType: "case_fee", payableRef: 5 });
    const res = mockRes();
    await createSponsorCheckoutSession(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.amount, 800); // 1000 - 200, server-computed
    assert.equal(tenantDb.SponsorPayment.create.mock.calls.length, 0);
  });
});

describe("Sponsor Payments — verify-session", () => {
  beforeEach(() => {
    for (const fn of Object.values(stripeSvc)) fn.mock.resetCalls();
  });

  it("rejects a session that belongs to another sponsor (403)", async () => {
    stripeSvc.getStripeForRequest.mock.mockImplementationOnce(async () => ({
      stripe: {
        checkout: {
          sessions: {
            retrieve: mock.fn(async () => ({
              metadata: { kind: "sponsor_payment", sponsorUserId: "99", payableType: "licence_fee", payableRef: "7" },
              payment_status: "paid",
              payment_intent: { id: "pi_1" },
            })),
          },
        },
      },
      settings: { stripe_secret_key: "sk_test_123" },
    }));
    const tenantDb = makeTenantDb();
    const req = makeReq(tenantDb, {}, { session_id: "cs_test_1" });
    const res = mockRes();
    await verifySponsorCheckoutSession(req, res);
    assert.equal(res.statusCode, 403);
  });

  it("finalises a paid licence fee by completing the ledger row", async () => {
    const row = { status: "pending", update: mock.fn(async function (patch) { Object.assign(this, patch); }) };
    stripeSvc.getStripeForRequest.mock.mockImplementationOnce(async () => ({
      stripe: {
        checkout: {
          sessions: {
            retrieve: mock.fn(async () => ({
              id: "cs_test_1",
              metadata: { kind: "sponsor_payment", sponsorUserId: String(USER_ID), payableType: "licence_fee", payableRef: "7" },
              payment_status: "paid",
              payment_intent: { id: "pi_1", amount: 57400, status: "succeeded" },
            })),
          },
        },
      },
      settings: { stripe_secret_key: "sk_test_123" },
    }));
    const tenantDb = makeTenantDb({
      SponsorPayment: {
        findOne: mock.fn(async () => row),
        findAll: mock.fn(async () => []),
        create: mock.fn(async () => ({})),
      },
    });
    const req = makeReq(tenantDb, {}, { session_id: "cs_test_1" });
    const res = mockRes();
    await verifySponsorCheckoutSession(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.paid, true);
    assert.equal(row.status, "completed");
    assert.equal(row.update.mock.calls.length, 1);
  });
});

describe("Sponsor Payments — computeSponsorPayables", () => {
  it("returns licence fee, ISC, and outstanding case balance as payables", async () => {
    const tenantDb = makeTenantDb({
      LicenceApplication: {
        findOne: mock.fn(async () => null),
        findAll: mock.fn(async () => [
          { id: 7, companyName: "Acme Ltd", status: "Pending", feeBase: 574, feeTotal: 574, feeIscEstimate: 1000, feeCurrency: "GBP" },
        ]),
      },
      Case: {
        findOne: mock.fn(async () => null),
        findAll: mock.fn(async () => [{ id: 5, caseId: "C-5", totalAmount: 1000, paidAmount: 200 }]),
      },
    });
    const req = makeReq(tenantDb);
    const payables = await computeSponsorPayables(req);

    const byType = Object.fromEntries(payables.map((p) => [p.payableType, p]));
    assert.equal(payables.length, 3);
    assert.equal(byType.licence_fee.amount, 574);
    assert.equal(byType.isc.amount, 1000);
    assert.equal(byType.case_fee.amount, 800);
    assert.equal(byType.case_fee.payableRef, "5");
  });

  it("omits a licence fee that has already been paid", async () => {
    const tenantDb = makeTenantDb({
      LicenceApplication: {
        findOne: mock.fn(async () => null),
        findAll: mock.fn(async () => [
          { id: 7, companyName: "Acme Ltd", status: "Pending", feeBase: 574, feeTotal: 574, feeIscEstimate: 0, feeCurrency: "GBP" },
        ]),
      },
      SponsorPayment: {
        findOne: mock.fn(async () => null),
        findAll: mock.fn(async () => [{ payableType: "licence_fee", payableRef: "7" }]),
        create: mock.fn(async () => ({})),
      },
    });
    const req = makeReq(tenantDb);
    const payables = await computeSponsorPayables(req);
    assert.equal(payables.find((p) => p.payableType === "licence_fee"), undefined);
  });
});
