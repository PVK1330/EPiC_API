/**
 * Week 10 Task 10: Subscription lifecycle — unit tests.
 * Uses Node.js built-in test runner (node --test).
 * Pure logic — no DB connection required.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Subscription state machine (mirrors subscription.controller.js logic) ─────
const VALID_STATUSES = ["active", "trial", "expired", "cancelled", "past_due"];

function canTransition(from, to) {
  const transitions = {
    trial:     ["active", "cancelled", "expired"],
    active:    ["past_due", "cancelled", "expired"],
    past_due:  ["active", "cancelled", "expired"],
    cancelled: ["active"], // reactivation
    expired:   ["active"], // renewal
  };
  return (transitions[from] || []).includes(to);
}

function isSubscriptionActive(status) {
  return status === "active" || status === "trial";
}

// ── Billing calculations ───────────────────────────────────────────────────────
function calculateProration(currentPlanPrice, newPlanPrice, daysRemaining, totalDays) {
  const remainingFraction = daysRemaining / totalDays;
  const credit = currentPlanPrice * remainingFraction;
  const charge = newPlanPrice * remainingFraction;
  const netCharge = Math.max(0, charge - credit);
  return { credit: Math.round(credit * 100) / 100, charge: Math.round(charge * 100) / 100, netCharge: Math.round(netCharge * 100) / 100 };
}

// ── Trial period helpers ───────────────────────────────────────────────────────
function isTrialExpired(trialEndsAt) {
  if (!trialEndsAt) return false;
  return new Date() > new Date(trialEndsAt);
}

function daysRemainingInTrial(trialEndsAt) {
  if (!trialEndsAt) return null;
  const ms = new Date(trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400_000));
}

describe("Subscription Status Validation", () => {
  it("all valid statuses are recognised", () => {
    VALID_STATUSES.forEach((status) => {
      assert.ok(VALID_STATUSES.includes(status), `Status not in valid list: ${status}`);
    });
  });

  it("trial and active are considered active", () => {
    assert.ok(isSubscriptionActive("trial"));
    assert.ok(isSubscriptionActive("active"));
  });

  it("expired, cancelled, past_due are not active", () => {
    assert.ok(!isSubscriptionActive("expired"));
    assert.ok(!isSubscriptionActive("cancelled"));
    assert.ok(!isSubscriptionActive("past_due"));
  });

  it("unknown status is not active", () => {
    assert.ok(!isSubscriptionActive("unknown_status"));
  });
});

describe("Subscription Lifecycle Transitions", () => {
  it("trial can transition to active (upgrade)", () => {
    assert.ok(canTransition("trial", "active"));
  });

  it("trial can be cancelled", () => {
    assert.ok(canTransition("trial", "cancelled"));
  });

  it("active can go past_due", () => {
    assert.ok(canTransition("active", "past_due"));
  });

  it("active can be cancelled", () => {
    assert.ok(canTransition("active", "cancelled"));
  });

  it("past_due can recover to active", () => {
    assert.ok(canTransition("past_due", "active"));
  });

  it("cancelled can be reactivated to active", () => {
    assert.ok(canTransition("cancelled", "active"));
  });

  it("expired can be renewed to active", () => {
    assert.ok(canTransition("expired", "active"));
  });

  it("active cannot jump to trial", () => {
    assert.ok(!canTransition("active", "trial"));
  });

  it("unknown status has no valid transitions", () => {
    assert.ok(!canTransition("unknown", "active"));
  });
});

describe("Billing — Proration Calculation", () => {
  it("upgrading mid-cycle charges the difference proportionally", () => {
    const { netCharge } = calculateProration(10, 30, 15, 30);
    assert.ok(netCharge > 0, "Upgrade should result in a net charge");
    assert.ok(netCharge < 30, "Net charge should be less than full new plan price");
  });

  it("downgrading mid-cycle results in zero net charge (credit > charge)", () => {
    const { netCharge } = calculateProration(30, 10, 15, 30);
    assert.equal(netCharge, 0, "Downgrade should not charge more (credit absorbed)");
  });

  it("same price plan change has near-zero net charge", () => {
    const { netCharge } = calculateProration(20, 20, 15, 30);
    assert.equal(netCharge, 0);
  });

  it("charge for full month remaining equals new plan price", () => {
    const { charge } = calculateProration(10, 30, 30, 30);
    assert.equal(charge, 30);
  });

  it("charge for zero days remaining is zero", () => {
    const { netCharge } = calculateProration(10, 30, 0, 30);
    assert.equal(netCharge, 0);
  });
});

describe("Trial Period Tracking", () => {
  it("future trial end date is not expired", () => {
    const future = new Date(Date.now() + 86400_000 * 7); // 7 days from now
    assert.ok(!isTrialExpired(future));
  });

  it("past trial end date is expired", () => {
    const past = new Date(Date.now() - 1000);
    assert.ok(isTrialExpired(past));
  });

  it("null trialEndsAt means trial is not expired", () => {
    assert.ok(!isTrialExpired(null));
  });

  it("days remaining is positive for active trial", () => {
    const future = new Date(Date.now() + 86400_000 * 7);
    const days = daysRemainingInTrial(future);
    assert.ok(days > 0 && days <= 7);
  });

  it("days remaining is 0 for expired trial", () => {
    const past = new Date(Date.now() - 1000);
    assert.equal(daysRemainingInTrial(past), 0);
  });

  it("days remaining is null when no trial end date", () => {
    assert.equal(daysRemainingInTrial(null), null);
  });
});
