/**
 * Week 8 Tasks 4 & 5: GDPR compliance + Self-serve onboarding wizard — unit tests.
 * Uses Node.js built-in test runner (node --test).
 * Pure logic — no DB connection required.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── GDPR retention policy helpers (mirrors gdpr.service.js) ──────────────────
const DEFAULT_RETENTION_DAYS = 365 * 3; // 3 years

function isEligibleForHardDelete(deletedAt, retentionDays = DEFAULT_RETENTION_DAYS) {
  if (!deletedAt) return false;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return new Date(deletedAt).getTime() < cutoff;
}

function computeRetentionCutoff(retentionDays = DEFAULT_RETENTION_DAYS) {
  return new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
}

// ── GDPR data export summary builder ─────────────────────────────────────────
function buildExportSummary(data) {
  return {
    exportedAt: new Date().toISOString(),
    summary: {
      users: data.users?.length ?? 0,
      cases: data.cases?.length ?? 0,
      documents: data.documents?.length ?? 0,
      auditLogs: data.auditLogs?.length ?? 0,
    },
  };
}

// ── PII anonymisation ─────────────────────────────────────────────────────────
function anonymiseUser(user, orgId) {
  return {
    ...user,
    first_name: "[DELETED]",
    last_name: "[DELETED]",
    email: `deleted_${orgId}_${Date.now()}@gdpr.invalid`,
    mobile: null,
    password: "GDPR_DELETED",
  };
}

function isPiiAnonymised(user) {
  return (
    user.first_name === "[DELETED]" &&
    user.last_name === "[DELETED]" &&
    user.email.endsWith("@gdpr.invalid") &&
    user.mobile === null &&
    user.password === "GDPR_DELETED"
  );
}

// ── Onboarding wizard logic (mirrors onboarding.controller.js) ────────────────
const ONBOARDING_STEPS = ["profile_setup", "plan_chosen", "team_invited", "trial_started"];

function computeOnboardingProgress(steps) {
  const completed = ONBOARDING_STEPS.filter((s) => Boolean(steps[s]));
  const next = ONBOARDING_STEPS.find((s) => !steps[s]) ?? null;
  const percent = Math.round((completed.length / ONBOARDING_STEPS.length) * 100);
  return { completed, next, percent, total: ONBOARDING_STEPS.length, done: completed.length };
}

function isOnboardingComplete(steps) {
  return ONBOARDING_STEPS.every((s) => Boolean(steps[s]));
}

function completeStep(existingSteps, stepKey) {
  if (!ONBOARDING_STEPS.includes(stepKey)) {
    throw new Error(`Invalid step: ${stepKey}`);
  }
  return { ...existingSteps, [stepKey]: new Date().toISOString() };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GDPR — Retention Policy", () => {
  it("record deleted 4 years ago is eligible for hard delete (> 3y retention)", () => {
    const deletedAt = new Date(Date.now() - 4 * 365 * 24 * 60 * 60 * 1000);
    assert.ok(isEligibleForHardDelete(deletedAt));
  });

  it("record deleted 2 years ago is NOT eligible (< 3y retention)", () => {
    const deletedAt = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);
    assert.ok(!isEligibleForHardDelete(deletedAt));
  });

  it("record with no deleted_at is not eligible for hard delete", () => {
    assert.ok(!isEligibleForHardDelete(null));
  });

  it("record deleted yesterday is not eligible", () => {
    const deletedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    assert.ok(!isEligibleForHardDelete(deletedAt));
  });

  it("retention cutoff is in the past", () => {
    const cutoff = computeRetentionCutoff();
    assert.ok(cutoff < new Date(), "Cutoff should be a past date");
  });

  it("default retention is 3 years (1095 days)", () => {
    assert.equal(DEFAULT_RETENTION_DAYS, 365 * 3);
  });

  it("custom 1-year retention applies correctly", () => {
    const deletedAt = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000); // 400 days ago
    assert.ok(isEligibleForHardDelete(deletedAt, 365));
  });
});

describe("GDPR — Data Export Summary", () => {
  it("export summary contains correct counts", () => {
    const data = {
      users: [{ id: 1 }, { id: 2 }],
      cases: [{ id: 10 }],
      documents: [{ id: 100 }, { id: 101 }, { id: 102 }],
      auditLogs: [],
    };
    const summary = buildExportSummary(data);
    assert.equal(summary.summary.users, 2);
    assert.equal(summary.summary.cases, 1);
    assert.equal(summary.summary.documents, 3);
    assert.equal(summary.summary.auditLogs, 0);
  });

  it("export summary includes an exportedAt timestamp", () => {
    const summary = buildExportSummary({ users: [], cases: [], documents: [], auditLogs: [] });
    assert.ok(typeof summary.exportedAt === "string");
    assert.ok(!isNaN(Date.parse(summary.exportedAt)));
  });

  it("empty dataset produces zero counts", () => {
    const summary = buildExportSummary({ users: [], cases: [], documents: [], auditLogs: [] });
    assert.equal(summary.summary.users, 0);
    assert.equal(summary.summary.cases, 0);
  });

  it("missing arrays default to 0 in summary", () => {
    const summary = buildExportSummary({});
    assert.equal(summary.summary.users, 0);
    assert.equal(summary.summary.cases, 0);
  });
});

describe("GDPR — PII Anonymisation", () => {
  const originalUser = {
    id: 42,
    first_name: "John",
    last_name: "Smith",
    email: "john.smith@example.com",
    mobile: "+447700900000",
    password: "hashed_password",
    role_id: 1,
  };

  it("anonymised user has [DELETED] first and last name", () => {
    const anon = anonymiseUser(originalUser, 1);
    assert.equal(anon.first_name, "[DELETED]");
    assert.equal(anon.last_name, "[DELETED]");
  });

  it("anonymised email ends with @gdpr.invalid", () => {
    const anon = anonymiseUser(originalUser, 1);
    assert.ok(anon.email.endsWith("@gdpr.invalid"));
  });

  it("anonymised mobile is null", () => {
    const anon = anonymiseUser(originalUser, 1);
    assert.equal(anon.mobile, null);
  });

  it("anonymised password is GDPR_DELETED marker", () => {
    const anon = anonymiseUser(originalUser, 1);
    assert.equal(anon.password, "GDPR_DELETED");
  });

  it("non-PII fields (id, role_id) are preserved", () => {
    const anon = anonymiseUser(originalUser, 1);
    assert.equal(anon.id, 42);
    assert.equal(anon.role_id, 1);
  });

  it("isPiiAnonymised returns true for anonymised user", () => {
    const anon = anonymiseUser(originalUser, 1);
    assert.ok(isPiiAnonymised(anon));
  });

  it("isPiiAnonymised returns false for original user", () => {
    assert.ok(!isPiiAnonymised(originalUser));
  });

  it("two users get different gdpr emails (using orgId + timestamp)", () => {
    const a1 = anonymiseUser(originalUser, 1);
    const a2 = anonymiseUser({ ...originalUser, id: 43 }, 2);
    assert.notEqual(a1.email, a2.email);
  });
});

describe("Onboarding Wizard — Step Progress", () => {
  it("0 steps completed = 0%", () => {
    const progress = computeOnboardingProgress({});
    assert.equal(progress.percent, 0);
    assert.equal(progress.done, 0);
  });

  it("1 of 4 steps = 25%", () => {
    const progress = computeOnboardingProgress({ profile_setup: new Date().toISOString() });
    assert.equal(progress.percent, 25);
    assert.equal(progress.done, 1);
  });

  it("2 of 4 steps = 50%", () => {
    const progress = computeOnboardingProgress({
      profile_setup: new Date().toISOString(),
      plan_chosen: new Date().toISOString(),
    });
    assert.equal(progress.percent, 50);
  });

  it("3 of 4 steps = 75%", () => {
    const progress = computeOnboardingProgress({
      profile_setup: new Date().toISOString(),
      plan_chosen: new Date().toISOString(),
      team_invited: new Date().toISOString(),
    });
    assert.equal(progress.percent, 75);
  });

  it("all 4 steps = 100%", () => {
    const steps = Object.fromEntries(ONBOARDING_STEPS.map((s) => [s, new Date().toISOString()]));
    const progress = computeOnboardingProgress(steps);
    assert.equal(progress.percent, 100);
    assert.equal(progress.done, 4);
  });

  it("next step is the first incomplete one", () => {
    const progress = computeOnboardingProgress({ profile_setup: new Date().toISOString() });
    assert.equal(progress.next, "plan_chosen");
  });

  it("next step is null when all steps are done", () => {
    const steps = Object.fromEntries(ONBOARDING_STEPS.map((s) => [s, new Date().toISOString()]));
    const progress = computeOnboardingProgress(steps);
    assert.equal(progress.next, null);
  });
});

describe("Onboarding Wizard — Step Completion", () => {
  it("completeStep adds step with timestamp", () => {
    const updated = completeStep({}, "profile_setup");
    assert.ok(Boolean(updated.profile_setup));
    assert.ok(!isNaN(Date.parse(updated.profile_setup)));
  });

  it("completeStep preserves existing completed steps", () => {
    const existing = { profile_setup: "2026-01-01T00:00:00Z" };
    const updated = completeStep(existing, "plan_chosen");
    assert.ok(Boolean(updated.profile_setup));
    assert.ok(Boolean(updated.plan_chosen));
  });

  it("completeStep throws for invalid step key", () => {
    assert.throws(() => completeStep({}, "not_a_real_step"), /Invalid step/);
  });

  it("isOnboardingComplete returns false when steps are partial", () => {
    assert.ok(!isOnboardingComplete({ profile_setup: "done" }));
  });

  it("isOnboardingComplete returns true when all steps done", () => {
    const steps = Object.fromEntries(ONBOARDING_STEPS.map((s) => [s, "done"]));
    assert.ok(isOnboardingComplete(steps));
  });

  it("exactly 4 onboarding steps defined", () => {
    assert.equal(ONBOARDING_STEPS.length, 4);
  });

  it("step order is: profile_setup → plan_chosen → team_invited → trial_started", () => {
    assert.deepEqual(ONBOARDING_STEPS, [
      "profile_setup",
      "plan_chosen",
      "team_invited",
      "trial_started",
    ]);
  });
});
