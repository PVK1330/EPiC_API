/**
 * Week 6 Task 3: E-signature support integration — unit tests.
 * Uses Node.js built-in test runner (node --test).
 * Pure logic — no DB connection required.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

// ── Token generation (mirrors esignature.controller.js) ───────────────────────
function generateSignatureToken() {
  return crypto.randomBytes(48).toString("hex");
}

function computeExpiresAt(expiryDays = 14) {
  const days = Math.min(expiryDays, 90);
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// ── Request status machine ────────────────────────────────────────────────────
const VALID_STATUSES = ["pending", "signed", "declined", "expired"];

function canSign(status, expiresAt) {
  if (status !== "pending") return false;
  return new Date() <= new Date(expiresAt);
}

function canDecline(status) {
  return status === "pending";
}

function isExpired(status, expiresAt) {
  if (status === "expired") return true;
  return status === "pending" && new Date() > new Date(expiresAt);
}

// ── Signature data validation ─────────────────────────────────────────────────
const MAX_SIGNATURE_SIZE = 500_000;
const VALID_SIGNATURE_TYPES = ["drawn", "typed"];

function validateSignatureData(signatureData, signatureType) {
  if (!signatureData) return { ok: false, reason: "signatureData is required" };
  if (signatureData.length > MAX_SIGNATURE_SIZE) return { ok: false, reason: "Signature data too large" };
  if (!VALID_SIGNATURE_TYPES.includes(signatureType)) {
    return { ok: false, reason: "signatureType must be drawn or typed" };
  }
  return { ok: true };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("E-Signature — Token Generation", () => {
  it("token is a 96-character hex string", () => {
    const token = generateSignatureToken();
    assert.match(token, /^[a-f0-9]{96}$/);
  });

  it("two generated tokens are unique", () => {
    const t1 = generateSignatureToken();
    const t2 = generateSignatureToken();
    assert.notEqual(t1, t2);
  });

  it("token is at least 64 characters long", () => {
    const token = generateSignatureToken();
    assert.ok(token.length >= 64, `Token too short: ${token.length}`);
  });

  it("token contains only hex characters", () => {
    const token = generateSignatureToken();
    assert.match(token, /^[0-9a-f]+$/);
  });
});

describe("E-Signature — Expiry Calculation", () => {
  it("default expiry is 14 days from now", () => {
    const expiry = computeExpiresAt(14);
    const diffDays = (expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    assert.ok(diffDays > 13.9 && diffDays <= 14.1, `Expected ~14 days, got ${diffDays}`);
  });

  it("expiry is capped at 90 days", () => {
    const expiry = computeExpiresAt(200);
    const diffDays = (expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    assert.ok(diffDays <= 90.1, "Expiry should be capped at 90 days");
  });

  it("1-day expiry produces a future date", () => {
    const expiry = computeExpiresAt(1);
    assert.ok(expiry > new Date(), "Expiry should be in the future");
  });
});

describe("E-Signature — Status Machine", () => {
  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const pastDate = new Date(Date.now() - 1000);

  it("pending request with future expiry can be signed", () => {
    assert.ok(canSign("pending", futureDate));
  });

  it("pending request with past expiry cannot be signed", () => {
    assert.ok(!canSign("pending", pastDate));
  });

  it("already signed request cannot be signed again", () => {
    assert.ok(!canSign("signed", futureDate));
  });

  it("declined request cannot be signed", () => {
    assert.ok(!canSign("declined", futureDate));
  });

  it("expired request cannot be signed", () => {
    assert.ok(!canSign("expired", futureDate));
  });

  it("pending request can be declined", () => {
    assert.ok(canDecline("pending"));
  });

  it("signed request cannot be declined", () => {
    assert.ok(!canDecline("signed"));
  });

  it("expired request cannot be declined", () => {
    assert.ok(!canDecline("expired"));
  });

  it("request with past expiry and pending status is considered expired", () => {
    assert.ok(isExpired("pending", pastDate));
  });

  it("request with status=expired is expired regardless of expiry date", () => {
    assert.ok(isExpired("expired", futureDate));
  });

  it("pending request with future expiry is not expired", () => {
    assert.ok(!isExpired("pending", futureDate));
  });
});

describe("E-Signature — Signature Data Validation", () => {
  const validData = "data:image/png;base64,abc123";

  it("valid drawn signature passes", () => {
    const result = validateSignatureData(validData, "drawn");
    assert.ok(result.ok);
  });

  it("valid typed signature passes", () => {
    const result = validateSignatureData("John Doe", "typed");
    assert.ok(result.ok);
  });

  it("missing signature data fails", () => {
    const result = validateSignatureData("", "drawn");
    assert.ok(!result.ok);
    assert.match(result.reason, /required/i);
  });

  it("null signature data fails", () => {
    const result = validateSignatureData(null, "drawn");
    assert.ok(!result.ok);
  });

  it("oversized signature data fails", () => {
    const bigData = "x".repeat(MAX_SIGNATURE_SIZE + 1);
    const result = validateSignatureData(bigData, "drawn");
    assert.ok(!result.ok);
    assert.match(result.reason, /too large/i);
  });

  it("data at exactly max size passes", () => {
    const maxData = "x".repeat(MAX_SIGNATURE_SIZE);
    const result = validateSignatureData(maxData, "drawn");
    assert.ok(result.ok);
  });

  it("invalid signature type fails", () => {
    const result = validateSignatureData(validData, "pdf");
    assert.ok(!result.ok);
    assert.match(result.reason, /drawn or typed/i);
  });

  it("only 'drawn' and 'typed' are valid types", () => {
    assert.equal(VALID_SIGNATURE_TYPES.length, 2);
    assert.ok(VALID_SIGNATURE_TYPES.includes("drawn"));
    assert.ok(VALID_SIGNATURE_TYPES.includes("typed"));
  });
});

describe("E-Signature — Valid Statuses", () => {
  it("exactly 4 statuses exist", () => {
    assert.equal(VALID_STATUSES.length, 4);
  });

  it("pending status exists", () => {
    assert.ok(VALID_STATUSES.includes("pending"));
  });

  it("signed status exists", () => {
    assert.ok(VALID_STATUSES.includes("signed"));
  });

  it("declined status exists", () => {
    assert.ok(VALID_STATUSES.includes("declined"));
  });

  it("expired status exists", () => {
    assert.ok(VALID_STATUSES.includes("expired"));
  });
});
