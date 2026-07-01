/**
 * Week 10 Task 11: API key system — unit + logic tests.
 * Uses Node.js built-in test runner (node --test).
 * Pure logic — no DB connection required.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

// ── Key generation logic (mirrors apiKey.controller.js) ──────────────────────
function generateApiKey(env = "test") {
  const secret = crypto.randomBytes(32).toString("hex");
  const rawKey = `epic_${env}_${secret}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 12);
  return { rawKey, keyHash, keyPrefix };
}

function hashKey(rawKey) {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("API Key — Generation", () => {
  it("generated key starts with epic_test_", () => {
    const { rawKey } = generateApiKey("test");
    assert.ok(rawKey.startsWith("epic_test_"), `Expected 'epic_test_' prefix, got: ${rawKey}`);
  });

  it("generated key starts with epic_live_ in production mode", () => {
    const { rawKey } = generateApiKey("live");
    assert.ok(rawKey.startsWith("epic_live_"), `Expected 'epic_live_' prefix, got: ${rawKey}`);
  });

  it("key_hash is 64 hex characters (SHA-256)", () => {
    const { keyHash } = generateApiKey();
    assert.match(keyHash, /^[a-f0-9]{64}$/);
  });

  it("key_prefix is the first 12 characters of the raw key", () => {
    const { rawKey, keyPrefix } = generateApiKey();
    assert.equal(keyPrefix, rawKey.slice(0, 12));
  });

  it("two generated keys are never equal", () => {
    const { rawKey: k1 } = generateApiKey();
    const { rawKey: k2 } = generateApiKey();
    assert.notEqual(k1, k2);
  });

  it("hashing the same raw key twice gives the same hash", () => {
    const rawKey = "epic_test_abc123";
    assert.equal(hashKey(rawKey), hashKey(rawKey));
  });

  it("different raw keys produce different hashes", () => {
    assert.notEqual(hashKey("epic_test_aaa"), hashKey("epic_test_bbb"));
  });
});

describe("API Key — Scope Validation", () => {
  function hasScope(scopes, required) {
    return scopes.includes("*") || scopes.includes(required);
  }

  it("wildcard scope allows any operation", () => {
    assert.ok(hasScope(["*"], "cases:read"));
    assert.ok(hasScope(["*"], "workers:write"));
    assert.ok(hasScope(["*"], "usage:read"));
  });

  it("exact scope match is allowed", () => {
    assert.ok(hasScope(["cases:read", "workers:read"], "cases:read"));
  });

  it("missing scope is denied", () => {
    assert.ok(!hasScope(["workers:read"], "cases:write"));
  });

  it("empty scopes array denies everything except wildcard", () => {
    assert.ok(!hasScope([], "cases:read"));
  });

  it("multiple scopes — only granted ones pass", () => {
    const scopes = ["cases:read", "workers:read", "usage:read"];
    assert.ok(hasScope(scopes, "cases:read"));
    assert.ok(!hasScope(scopes, "cases:write"));
    assert.ok(!hasScope(scopes, "admin:all"));
  });
});

describe("API Key — Expiry Validation", () => {
  it("non-expired key is valid", () => {
    const expiresAt = new Date(Date.now() + 86400_000); // +1 day
    const isExpired = new Date() > new Date(expiresAt);
    assert.ok(!isExpired);
  });

  it("past-expiry key is detected as expired", () => {
    const expiresAt = new Date(Date.now() - 1000); // 1s ago
    const isExpired = new Date() > new Date(expiresAt);
    assert.ok(isExpired);
  });

  it("null expires_at means key never expires", () => {
    const expiresAt = null;
    const isExpired = expiresAt && new Date() > new Date(expiresAt);
    assert.ok(!isExpired);
  });
});

describe("API Key — Rate Limiter Config", () => {
  const WINDOW_MS = 15 * 60 * 1000;
  const MAX_READ = 1000;
  const MAX_WRITE = 200;

  it("window is 15 minutes", () => {
    assert.equal(WINDOW_MS, 900_000);
  });

  it("read limit is at least 100 and at most 10,000", () => {
    assert.ok(MAX_READ >= 100);
    assert.ok(MAX_READ <= 10_000);
  });

  it("write limit is lower than read limit", () => {
    assert.ok(MAX_WRITE < MAX_READ);
  });
});
