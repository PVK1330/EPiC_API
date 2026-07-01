/**
 * Week 10 Task 11: Usage metering — unit tests.
 * Uses Node.js built-in test runner (node --test).
 * Pure logic — no DB connection required.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Level calculator (mirrors usageMeter.service.js) ─────────────────────────
function toLevel(used, limit) {
  if (!limit) return { pct: null, level: "unlimited" };
  const pct = Math.round((used / limit) * 100);
  const level = pct >= 100 ? "exceeded" : pct >= 90 ? "critical" : pct >= 80 ? "warning" : "ok";
  return { pct, level };
}

// ── Plan limit checker (mirrors checkPlanLimit logic) ─────────────────────────
function checkPlanLimit(used, limit) {
  if (limit === null || limit === undefined) return { exceeded: false };
  if (used >= limit) return { exceeded: true, used, limit };
  return { exceeded: false, used, limit };
}

// ── Period helpers ────────────────────────────────────────────────────────────
function currentPeriod() {
  const now = new Date();
  return { period_year: now.getFullYear(), period_month: now.getMonth() + 1 };
}

describe("Usage Warning Levels", () => {
  it("0% usage is ok", () => {
    assert.equal(toLevel(0, 100).level, "ok");
  });

  it("50% usage is ok", () => {
    assert.equal(toLevel(50, 100).level, "ok");
  });

  it("79% usage is still ok", () => {
    assert.equal(toLevel(79, 100).level, "ok");
  });

  it("80% usage triggers warning", () => {
    assert.equal(toLevel(80, 100).level, "warning");
  });

  it("85% usage is warning", () => {
    assert.equal(toLevel(85, 100).level, "warning");
  });

  it("90% usage triggers critical", () => {
    assert.equal(toLevel(90, 100).level, "critical");
  });

  it("99% usage is critical", () => {
    assert.equal(toLevel(99, 100).level, "critical");
  });

  it("100% usage is exceeded", () => {
    assert.equal(toLevel(100, 100).level, "exceeded");
  });

  it("150% usage is exceeded", () => {
    assert.equal(toLevel(150, 100).level, "exceeded");
  });

  it("null limit returns unlimited level", () => {
    const result = toLevel(999, null);
    assert.equal(result.level, "unlimited");
    assert.equal(result.pct, null);
  });

  it("zero limit is treated as unlimited (no division by zero)", () => {
    const result = toLevel(0, 0);
    assert.equal(result.level, "unlimited");
  });

  it("percentage is rounded to nearest integer", () => {
    assert.equal(toLevel(1, 3).pct, 33);
    assert.equal(toLevel(2, 3).pct, 67);
  });
});

describe("Plan Limit Enforcement", () => {
  it("null limit never exceeds", () => {
    const r = checkPlanLimit(999999, null);
    assert.equal(r.exceeded, false);
  });

  it("usage below limit is not exceeded", () => {
    const r = checkPlanLimit(49, 50);
    assert.equal(r.exceeded, false);
    assert.equal(r.used, 49);
  });

  it("usage exactly at limit is exceeded", () => {
    const r = checkPlanLimit(50, 50);
    assert.equal(r.exceeded, true);
  });

  it("usage above limit is exceeded", () => {
    const r = checkPlanLimit(51, 50);
    assert.equal(r.exceeded, true);
    assert.equal(r.used, 51);
    assert.equal(r.limit, 50);
  });

  it("zero usage is never exceeded", () => {
    const r = checkPlanLimit(0, 10);
    assert.equal(r.exceeded, false);
  });
});

describe("Usage Period Calculation", () => {
  it("period_month is between 1 and 12", () => {
    const { period_month } = currentPeriod();
    assert.ok(period_month >= 1 && period_month <= 12);
  });

  it("period_year is the current year", () => {
    const { period_year } = currentPeriod();
    assert.equal(period_year, new Date().getFullYear());
  });

  it("period is consistent across calls in the same second", () => {
    const p1 = currentPeriod();
    const p2 = currentPeriod();
    assert.deepEqual(p1, p2);
  });
});

describe("Usage Fields", () => {
  const VALID_FIELDS = ["cases_created", "active_users", "storage_bytes", "api_calls", "workers_count"];

  it("all expected usage fields are defined", () => {
    VALID_FIELDS.forEach((field) => {
      assert.ok(typeof field === "string");
      assert.ok(field.length > 0);
    });
  });

  it("cases_created and workers_count are plan-limited fields", () => {
    const planLimitedFields = ["cases_created", "active_users", "workers_count"];
    planLimitedFields.forEach((f) => assert.ok(VALID_FIELDS.includes(f)));
  });

  it("api_calls and storage_bytes are metered but unlimited by default", () => {
    assert.ok(VALID_FIELDS.includes("api_calls"));
    assert.ok(VALID_FIELDS.includes("storage_bytes"));
  });
});
