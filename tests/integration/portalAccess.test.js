/**
 * Week 6 Task 1: 30-day post-closure portal access rule — unit tests.
 * Uses Node.js built-in test runner (node --test).
 * Pure logic — no DB connection required.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Portal access rule (mirrors candidatePortalAccess.middleware.js) ──────────
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function hasPortalAccess(cases) {
  if (!cases.length) return true; // no cases → no restriction
  const now = Date.now();
  return cases.some((c) => {
    if (c.status !== "Closed") return true;
    const closedAt = c.closed_at ? new Date(c.closed_at).getTime() : null;
    if (!closedAt) return true; // no close timestamp → allow
    return now - closedAt < THIRTY_DAYS_MS;
  });
}

// ── closed_at auto-set logic (mirrors admin/case.controller.js) ───────────────
function computeClosedAt(oldStatus, newStatus, existingClosedAt) {
  const isClosingNow = newStatus === "Closed" && oldStatus !== "Closed";
  const isReopening = oldStatus === "Closed" && newStatus !== "Closed";
  if (isClosingNow) return new Date();
  if (isReopening) return null;
  return existingClosedAt;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function daysFromNow(n) {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Portal Access — Active Cases", () => {
  it("candidate with one active (non-Closed) case has access", () => {
    const cases = [{ status: "In Progress", closed_at: null }];
    assert.ok(hasPortalAccess(cases));
  });

  it("candidate with mixed cases (one open, one closed) has access", () => {
    const cases = [
      { status: "Closed", closed_at: daysAgo(40) },
      { status: "In Progress", closed_at: null },
    ];
    assert.ok(hasPortalAccess(cases));
  });

  it("candidate with no cases has access (no restriction without cases)", () => {
    assert.ok(hasPortalAccess([]));
  });

  it("candidate with Approved case has access", () => {
    const cases = [{ status: "Approved", closed_at: null }];
    assert.ok(hasPortalAccess(cases));
  });
});

describe("Portal Access — Closure Within 30 Days", () => {
  it("case closed today still grants access", () => {
    const cases = [{ status: "Closed", closed_at: new Date() }];
    assert.ok(hasPortalAccess(cases));
  });

  it("case closed 15 days ago still grants access", () => {
    const cases = [{ status: "Closed", closed_at: daysAgo(15) }];
    assert.ok(hasPortalAccess(cases));
  });

  it("case closed exactly 29 days ago still grants access", () => {
    const cases = [{ status: "Closed", closed_at: daysAgo(29) }];
    assert.ok(hasPortalAccess(cases));
  });

  it("case closed with no closed_at timestamp grants access (safe default)", () => {
    const cases = [{ status: "Closed", closed_at: null }];
    assert.ok(hasPortalAccess(cases));
  });
});

describe("Portal Access — Expired After 30 Days", () => {
  it("case closed exactly 30 days ago loses access", () => {
    const cases = [{ status: "Closed", closed_at: daysAgo(30) }];
    assert.ok(!hasPortalAccess(cases));
  });

  it("case closed 31 days ago loses access", () => {
    const cases = [{ status: "Closed", closed_at: daysAgo(31) }];
    assert.ok(!hasPortalAccess(cases));
  });

  it("all cases closed 60 days ago lose access", () => {
    const cases = [
      { status: "Closed", closed_at: daysAgo(60) },
      { status: "Closed", closed_at: daysAgo(45) },
    ];
    assert.ok(!hasPortalAccess(cases));
  });

  it("case closed 365 days ago loses access", () => {
    const cases = [{ status: "Closed", closed_at: daysAgo(365) }];
    assert.ok(!hasPortalAccess(cases));
  });
});

describe("closed_at Auto-Set on Status Change", () => {
  it("setting status to Closed stamps closed_at with current time", () => {
    const result = computeClosedAt("In Progress", "Closed", null);
    assert.ok(result instanceof Date, "closed_at should be a Date");
    const diff = Math.abs(Date.now() - result.getTime());
    assert.ok(diff < 1000, "closed_at should be approximately now");
  });

  it("reopening a Closed case clears closed_at", () => {
    const result = computeClosedAt("Closed", "In Progress", daysAgo(5));
    assert.equal(result, null);
  });

  it("status change not involving Closed preserves existing closed_at", () => {
    const original = daysAgo(10);
    const result = computeClosedAt("Pending", "In Progress", original);
    assert.equal(result, original);
  });

  it("closing an already-Closed case does not re-stamp closed_at", () => {
    const original = daysAgo(5);
    const result = computeClosedAt("Closed", "Closed", original);
    assert.equal(result, original);
  });

  it("closing a Lead case stamps closed_at", () => {
    const result = computeClosedAt("Lead", "Closed", null);
    assert.ok(result instanceof Date);
  });
});
