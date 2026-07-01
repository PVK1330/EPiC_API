/**
 * Week 8 Tasks 6 & 7: Email drip sequence + Sandbox environment — unit tests.
 * Uses Node.js built-in test runner (node --test).
 * Pure logic — no DB connection required.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Trial drip email logic (mirrors onboardingEmail.service.js) ───────────────
const ONE_DAY = 24 * 60 * 60 * 1000;

function trialDaysRemaining(trialEndsAt) {
  if (!trialEndsAt) return null;
  return Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / ONE_DAY);
}

function selectDripEmail(steps, daysLeft) {
  if (daysLeft === null) return null;
  if (daysLeft <= 7 && daysLeft > 0 && !steps.trial_day7) return "trial_day7";
  if (daysLeft <= 0 && daysLeft > -1 && !steps.trial_day14) return "trial_day14";
  if (daysLeft <= -1 && daysLeft > -2 && !steps.conversion_nudge) return "conversion_nudge";
  return null;
}

function isDripAlreadySent(steps, emailKey) {
  return Boolean(steps[emailKey]);
}

// ── Welcome email subjects ─────────────────────────────────────────────────────
function buildDripSubject(orgName, type) {
  const subjects = {
    welcome: `Welcome to EPiC CMS — ${orgName} is ready`,
    trial_day7: `${orgName} — Your trial has 7 days remaining`,
    trial_day14: `${orgName} — Your trial expires today`,
    conversion_nudge: `${orgName} — Your trial has ended. Come back!`,
  };
  return subjects[type] ?? null;
}

// ── Sandbox helpers (mirrors sandbox.service.js) ──────────────────────────────
const SANDBOX_PREFIX = "demo_";

function isSandboxOrg(org) {
  return Boolean(org.is_sandbox);
}

function buildSandboxSlug(randomHex) {
  return `${SANDBOX_PREFIX}${randomHex}`;
}

function buildSandboxSeedData(orgId) {
  const statuses = ["Lead", "Pending", "In Progress", "Submitted", "Approved"];
  return {
    users: [
      { email: "demo.admin@sandbox.epic", role_id: 3 },
      { email: "demo.caseworker@sandbox.epic", role_id: 2 },
      { email: "demo.candidate@sandbox.epic", role_id: 1 },
    ],
    cases: statuses.map((status, i) => ({
      caseId: `DEMO-00${i + 1}`,
      status,
      organisation_id: orgId,
    })),
  };
}

function isSandboxEmail(email) {
  return email.endsWith("@sandbox.epic");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Email Drip — Trial Days Remaining", () => {
  it("returns null when trial_ends_at is null", () => {
    assert.equal(trialDaysRemaining(null), null);
  });

  it("7 days from now returns positive value close to 7", () => {
    const future = new Date(Date.now() + 7 * ONE_DAY);
    const days = trialDaysRemaining(future);
    assert.ok(days >= 6 && days <= 7, `Expected ~7, got ${days}`);
  });

  it("expired trial returns 0 or negative", () => {
    const past = new Date(Date.now() - 1000);
    const days = trialDaysRemaining(past);
    assert.ok(days <= 0);
  });

  it("trial ending in 14 days returns approximately 14", () => {
    const future = new Date(Date.now() + 14 * ONE_DAY);
    const days = trialDaysRemaining(future);
    assert.ok(days >= 13 && days <= 14);
  });
});

describe("Email Drip — Email Selection Logic", () => {
  it("selects trial_day7 when 5 days remain and not yet sent", () => {
    const future = new Date(Date.now() + 5 * ONE_DAY);
    const days = trialDaysRemaining(future);
    const email = selectDripEmail({}, days);
    assert.equal(email, "trial_day7");
  });

  it("selects trial_day7 when exactly 7 days remain", () => {
    const email = selectDripEmail({}, 7);
    assert.equal(email, "trial_day7");
  });

  it("does NOT re-send trial_day7 if already sent", () => {
    const email = selectDripEmail({ trial_day7: "2026-01-01T00:00:00Z" }, 5);
    assert.notEqual(email, "trial_day7");
  });

  it("selects trial_day14 when 0 days remain (expiry day)", () => {
    const email = selectDripEmail({}, 0);
    assert.equal(email, "trial_day14");
  });

  it("selects conversion_nudge the day after trial ends (daysLeft = -1)", () => {
    const email = selectDripEmail({}, -1);
    assert.equal(email, "conversion_nudge");
  });

  it("returns null when more than 7 days remain", () => {
    const email = selectDripEmail({}, 10);
    assert.equal(email, null);
  });

  it("returns null when all relevant emails already sent", () => {
    const steps = {
      trial_day7: "sent",
      trial_day14: "sent",
      conversion_nudge: "sent",
    };
    assert.equal(selectDripEmail(steps, 5), null);
    assert.equal(selectDripEmail(steps, 0), null);
    assert.equal(selectDripEmail(steps, -1), null);
  });

  it("returns null when trial_ends_at is null", () => {
    assert.equal(selectDripEmail({}, null), null);
  });
});

describe("Email Drip — Duplicate Prevention", () => {
  it("isDripAlreadySent returns true when email key exists in steps", () => {
    assert.ok(isDripAlreadySent({ trial_day7: "2026-01-01" }, "trial_day7"));
  });

  it("isDripAlreadySent returns false when key is missing", () => {
    assert.ok(!isDripAlreadySent({}, "trial_day7"));
  });

  it("isDripAlreadySent returns false for undefined step value", () => {
    assert.ok(!isDripAlreadySent({ trial_day7: undefined }, "trial_day7"));
  });
});

describe("Email Drip — Subject Lines", () => {
  const orgName = "Acme Immigration";

  it("welcome email has correct subject", () => {
    const subject = buildDripSubject(orgName, "welcome");
    assert.ok(subject.includes(orgName));
    assert.ok(subject.toLowerCase().includes("welcome"));
  });

  it("trial_day7 email references org name", () => {
    const subject = buildDripSubject(orgName, "trial_day7");
    assert.ok(subject.includes(orgName));
    assert.ok(subject.includes("7"));
  });

  it("trial_day14 subject indicates expiry", () => {
    const subject = buildDripSubject(orgName, "trial_day14");
    assert.ok(subject.toLowerCase().includes("expires"));
  });

  it("conversion_nudge references ending", () => {
    const subject = buildDripSubject(orgName, "conversion_nudge");
    assert.ok(subject.toLowerCase().includes("ended"));
  });

  it("unknown email type returns null subject", () => {
    const subject = buildDripSubject(orgName, "unknown_type");
    assert.equal(subject, null);
  });

  it("all 4 email types have distinct subjects", () => {
    const types = ["welcome", "trial_day7", "trial_day14", "conversion_nudge"];
    const subjects = types.map((t) => buildDripSubject(orgName, t));
    const unique = new Set(subjects);
    assert.equal(unique.size, 4);
  });
});

describe("Sandbox — Organisation Identification", () => {
  it("org with is_sandbox=true is identified as sandbox", () => {
    assert.ok(isSandboxOrg({ id: 1, name: "Demo", is_sandbox: true }));
  });

  it("org with is_sandbox=false is not a sandbox", () => {
    assert.ok(!isSandboxOrg({ id: 2, name: "Real Corp", is_sandbox: false }));
  });

  it("org without is_sandbox field is not a sandbox", () => {
    assert.ok(!isSandboxOrg({ id: 3, name: "Unknown" }));
  });
});

describe("Sandbox — Slug Generation", () => {
  it("sandbox slug starts with 'demo_'", () => {
    const slug = buildSandboxSlug("ab12cd34");
    assert.ok(slug.startsWith("demo_"), `Expected demo_ prefix, got: ${slug}`);
  });

  it("sandbox slug includes the random hex suffix", () => {
    const hex = "abc12345";
    const slug = buildSandboxSlug(hex);
    assert.ok(slug.includes(hex));
  });

  it("two different hex strings produce different slugs", () => {
    const s1 = buildSandboxSlug("aaaaaaaa");
    const s2 = buildSandboxSlug("bbbbbbbb");
    assert.notEqual(s1, s2);
  });
});

describe("Sandbox — Seed Data Structure", () => {
  const seed = buildSandboxSeedData(99);

  it("seed contains exactly 3 demo users", () => {
    assert.equal(seed.users.length, 3);
  });

  it("seed includes an admin user (role_id=3)", () => {
    assert.ok(seed.users.some((u) => u.role_id === 3));
  });

  it("seed includes a caseworker user (role_id=2)", () => {
    assert.ok(seed.users.some((u) => u.role_id === 2));
  });

  it("seed includes a candidate user (role_id=1)", () => {
    assert.ok(seed.users.some((u) => u.role_id === 1));
  });

  it("all demo users have @sandbox.epic emails", () => {
    seed.users.forEach((u) => assert.ok(isSandboxEmail(u.email), `Not a sandbox email: ${u.email}`));
  });

  it("seed contains exactly 5 demo cases", () => {
    assert.equal(seed.cases.length, 5);
  });

  it("demo cases cover the full status spectrum", () => {
    const statuses = seed.cases.map((c) => c.status);
    assert.ok(statuses.includes("Lead"));
    assert.ok(statuses.includes("Approved"));
    assert.ok(statuses.includes("In Progress"));
  });

  it("all demo case IDs start with DEMO-", () => {
    seed.cases.forEach((c) => assert.ok(c.caseId.startsWith("DEMO-")));
  });

  it("all seed cases belong to the provided orgId", () => {
    seed.cases.forEach((c) => assert.equal(c.organisation_id, 99));
  });
});
