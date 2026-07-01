/**
 * Week 10 Task 9: Multi-tenant isolation — unit tests.
 * Uses Node.js built-in test runner (node --test).
 * Pure logic — no DB connection required.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Slug normalisation (mirrors superadminOrganisation.controller.js) ─────────
function slugify(name) {
  const s = String(name || "org")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 90);
  return s || "org";
}

// ── Tenant DB name builder (mirrors tenantDb naming) ─────────────────────────
function tenantDbName(platformDbName, slug) {
  return `${platformDbName}_tenant_${slug.replace(/-/g, "_")}`;
}

// ── Cross-tenant access check (mirrors middleware logic) ──────────────────────
function isCrossTenantAccess(requestOrgId, resourceOrgId) {
  return Number(requestOrgId) !== Number(resourceOrgId);
}

describe("Tenant Slug Generation", () => {
  it("converts spaces to hyphens", () => {
    assert.equal(slugify("My Company"), "my-company");
  });

  it("lowercases the name", () => {
    assert.equal(slugify("ACME Corp"), "acme-corp");
  });

  it("removes special characters", () => {
    assert.equal(slugify("Company & Sons!"), "company--sons");
  });

  it("truncates to 90 characters", () => {
    const long = "a".repeat(100);
    assert.equal(slugify(long).length, 90);
  });

  it("returns 'org' for empty string", () => {
    assert.equal(slugify(""), "org");
  });

  it("returns 'org' for null input", () => {
    assert.equal(slugify(null), "org");
  });

  it("two organisations with same name get the same slug (DB constraint enforces uniqueness)", () => {
    assert.equal(slugify("Acme"), slugify("acme"));
  });
});

describe("Tenant Database Name Construction", () => {
  it("builds correct DB name from platform DB and slug", () => {
    assert.equal(tenantDbName("epic_api", "acme"), "epic_api_tenant_acme");
  });

  it("replaces hyphens with underscores in DB name", () => {
    assert.equal(tenantDbName("epic_api", "my-company"), "epic_api_tenant_my_company");
  });

  it("two different slugs produce different DB names", () => {
    const db1 = tenantDbName("epic_api", "acme");
    const db2 = tenantDbName("epic_api", "globex");
    assert.notEqual(db1, db2);
  });

  it("DB name contains platform DB prefix for identification", () => {
    const dbName = tenantDbName("epic_api", "acme");
    assert.ok(dbName.startsWith("epic_api"), `Expected prefix 'epic_api', got: ${dbName}`);
  });
});

describe("Cross-Tenant Access Prevention", () => {
  it("same org ID is not cross-tenant", () => {
    assert.ok(!isCrossTenantAccess(1, 1));
  });

  it("different org IDs is cross-tenant access", () => {
    assert.ok(isCrossTenantAccess(1, 2));
  });

  it("string and number comparison works correctly", () => {
    assert.ok(!isCrossTenantAccess("5", 5));
  });

  it("null requestOrgId triggers cross-tenant flag", () => {
    assert.ok(isCrossTenantAccess(null, 1));
  });
});

describe("Tenant Data Isolation — Scoped Query Pattern", () => {
  // Simulates how every tenant query must include organisation_id in WHERE clause
  function buildScopedQuery(organisationId, additionalWhere = {}) {
    if (!organisationId) throw new Error("organisation_id is required for tenant queries");
    return { organisation_id: organisationId, ...additionalWhere };
  }

  it("scoped query always includes organisation_id", () => {
    const where = buildScopedQuery(42);
    assert.equal(where.organisation_id, 42);
  });

  it("scoped query merges additional conditions", () => {
    const where = buildScopedQuery(42, { status: "active" });
    assert.equal(where.organisation_id, 42);
    assert.equal(where.status, "active");
  });

  it("throws when organisation_id is missing", () => {
    assert.throws(() => buildScopedQuery(null), /organisation_id is required/);
  });

  it("two tenants with same resource id still have distinct queries", () => {
    const q1 = buildScopedQuery(1, { case_id: 100 });
    const q2 = buildScopedQuery(2, { case_id: 100 });
    assert.notEqual(q1.organisation_id, q2.organisation_id);
    assert.equal(q1.case_id, q2.case_id); // same resource id, different tenant
  });
});

describe("Feature Flag per Plan", () => {
  // Simulates plan feature flag enforcement
  const PLAN_FEATURES = {
    starter:      { max_cases: 50,   max_users: 5,  api_access: false, webhooks: false },
    professional: { max_cases: 500,  max_users: 25, api_access: true,  webhooks: true  },
    enterprise:   { max_cases: null, max_users: null, api_access: true, webhooks: true },
  };

  function hasFeature(planName, feature) {
    const plan = PLAN_FEATURES[planName];
    if (!plan) return false;
    return Boolean(plan[feature]);
  }

  it("starter plan does not have API access", () => {
    assert.ok(!hasFeature("starter", "api_access"));
  });

  it("professional plan has API access", () => {
    assert.ok(hasFeature("professional", "api_access"));
  });

  it("enterprise plan has webhooks", () => {
    assert.ok(hasFeature("enterprise", "webhooks"));
  });

  it("starter has case limit of 50", () => {
    assert.equal(PLAN_FEATURES.starter.max_cases, 50);
  });

  it("enterprise has unlimited cases (null)", () => {
    assert.equal(PLAN_FEATURES.enterprise.max_cases, null);
  });
});
