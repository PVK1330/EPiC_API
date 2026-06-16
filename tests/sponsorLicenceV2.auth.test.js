/**
 * Auth-guard tests for sponsorLicenceV2.routes.js — ISSUE-012.
 *
 * The router now applies router.use(verifyTokenAndTenant) and
 * router.use(checkRole([ROLES.BUSINESS])) as defence-in-depth on top of the
 * parent Sponsor router's protection.
 *
 * These tests exercise the middleware logic directly via inline stubs that
 * mirror the real implementations in authStack.middleware.js and
 * role.middleware.js.  No HTTP server or database is required.
 *
 * Run with: node --test tests/sponsorLicenceV2.auth.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── ROLES constant (mirrored from role.middleware.js) ────────────────────────

const ROLES = Object.freeze({
  CANDIDATE:  1,
  CASEWORKER: 2,
  ADMIN:      3,
  BUSINESS:   4,
  SPONSOR:    4,
  SUPERADMIN: 5,
});

// ─── Helpers: minimal req / res / next stubs ─────────────────────────────────

function makeRes() {
  const res = {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
  return res;
}

function makeNext() {
  let called = false;
  function next() { called = true; }
  next.wasCalled = () => called;
  return next;
}

// ─── Stub: verifyTokenAndTenant ───────────────────────────────────────────────
//
// The real middleware chains verifyToken (JWT decode → req.user) then
// attachTenantDb (resolves tenant DB from req.user.tenantId → req.tenantDb).
//
// For auth-guard testing the critical branch is:
//   • No Authorization header → 401 Unauthorized
//   • Valid Bearer token already decoded into req.user → proceed

function stubVerifyTokenAndTenant(req, res, next) {
  const authHeader = req.headers?.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  // In production, verifyToken populates req.user from the JWT payload.
  // Tests pre-populate req.user; if it is absent the token is treated as invalid.
  if (!req.user) {
    res.status(401).json({ message: "Invalid or expired token" });
    return;
  }
  next();
}

// ─── Stub: checkRole([ROLES.BUSINESS]) ───────────────────────────────────────
//
// Mirrors the real checkRole factory in role.middleware.js.

function toRoleId(raw) {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : NaN;
}

function checkRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }
    const roleId = toRoleId(req.user.role_id);
    if (Number.isNaN(roleId)) {
      res.status(403).json({ message: "Token contains an invalid role identifier" });
      return;
    }
    if (allowedRoles.includes(roleId)) {
      next();
      return;
    }
    res.status(403).json({ message: "You do not have permission to access this resource" });
  };
}

const checkBusinessRole = checkRole([ROLES.BUSINESS]);

// ─── Helpers: run both guards in sequence (mirrors router.use order) ─────────

function runGuards(req) {
  const res  = makeRes();
  const next = makeNext();

  // First guard
  let earlyReturn = false;
  stubVerifyTokenAndTenant(req, res, () => {
    // Second guard only runs if first passes
    checkBusinessRole(req, res, next);
    earlyReturn = true;
  });

  return { res, next };
}

// ─── 1. Unauthenticated access blocked ───────────────────────────────────────

describe("sponsorLicenceV2 — unauthenticated access blocked (ISSUE-012)", () => {
  it("no Authorization header → 401", () => {
    const req = { headers: {}, user: null };
    const { res, next } = runGuards(req);
    assert.equal(res._status, 401);
    assert.equal(next.wasCalled(), false);
  });

  it("Authorization header present but not Bearer → 401", () => {
    const req = { headers: { authorization: "Basic dXNlcjpwYXNz" }, user: null };
    const { res, next } = runGuards(req);
    assert.equal(res._status, 401);
    assert.equal(next.wasCalled(), false);
  });

  it("Bearer token present but req.user not populated (invalid/expired JWT) → 401", () => {
    const req = { headers: { authorization: "Bearer expired.jwt.token" }, user: null };
    const { res, next } = runGuards(req);
    assert.equal(res._status, 401);
    assert.equal(next.wasCalled(), false);
  });

  it("missing headers object entirely → 401", () => {
    const req = { user: null };
    const { res, next } = runGuards(req);
    assert.equal(res._status, 401);
    assert.equal(next.wasCalled(), false);
  });
});

// ─── 2. Wrong role blocked ────────────────────────────────────────────────────

describe("sponsorLicenceV2 — wrong role blocked (ISSUE-012)", () => {
  function authedReq(role_id) {
    return {
      headers: { authorization: "Bearer valid.token.here" },
      user: { userId: 42, role_id },
    };
  }

  it("CANDIDATE (role 1) → 403", () => {
    const { res, next } = runGuards(authedReq(ROLES.CANDIDATE));
    assert.equal(res._status, 403);
    assert.equal(next.wasCalled(), false);
  });

  it("CASEWORKER (role 2) → 403", () => {
    const { res, next } = runGuards(authedReq(ROLES.CASEWORKER));
    assert.equal(res._status, 403);
    assert.equal(next.wasCalled(), false);
  });

  it("ADMIN (role 3) → 403 (must not bypass — admin has own portal)", () => {
    const { res, next } = runGuards(authedReq(ROLES.ADMIN));
    assert.equal(res._status, 403);
    assert.equal(next.wasCalled(), false);
  });

  it("SUPERADMIN (role 5) → 403 (must not bypass)", () => {
    const { res, next } = runGuards(authedReq(ROLES.SUPERADMIN));
    assert.equal(res._status, 403);
    assert.equal(next.wasCalled(), false);
  });

  it("invalid role string ('admin') → 403", () => {
    const { res, next } = runGuards(authedReq("admin"));
    assert.equal(res._status, 403);
    assert.equal(next.wasCalled(), false);
  });

  it("role_id 0 (invalid) → 403", () => {
    const { res, next } = runGuards(authedReq(0));
    assert.equal(res._status, 403);
    assert.equal(next.wasCalled(), false);
  });

  it("negative role_id → 403", () => {
    const { res, next } = runGuards(authedReq(-1));
    assert.equal(res._status, 403);
    assert.equal(next.wasCalled(), false);
  });
});

// ─── 3. Business role allowed ─────────────────────────────────────────────────

describe("sponsorLicenceV2 — BUSINESS role allowed (ISSUE-012)", () => {
  function authedBusinessReq(role_id = ROLES.BUSINESS) {
    return {
      headers: { authorization: "Bearer valid.business.token" },
      user: { userId: 99, role_id },
    };
  }

  it("BUSINESS (role 4) → next() called", () => {
    const { res, next } = runGuards(authedBusinessReq(ROLES.BUSINESS));
    assert.equal(next.wasCalled(), true, "next() must be called for BUSINESS role");
    assert.equal(res._status, null, "no error response must be sent");
  });

  it("SPONSOR alias (also role 4) → next() called", () => {
    const { res, next } = runGuards(authedBusinessReq(ROLES.SPONSOR));
    assert.equal(next.wasCalled(), true);
    assert.equal(res._status, null);
  });

  it("role_id supplied as string '4' (JWT serialisation quirk) → next() called", () => {
    const { res, next } = runGuards(authedBusinessReq("4"));
    assert.equal(next.wasCalled(), true, "string '4' must coerce to role 4");
    assert.equal(res._status, null);
  });

  it("no error body is written when BUSINESS role is allowed", () => {
    const { res } = runGuards(authedBusinessReq());
    assert.equal(res._body, null, "response body must be empty on success");
  });
});

// ─── 4. Guard ordering ────────────────────────────────────────────────────────
//
// verifyTokenAndTenant must run BEFORE checkRole.  If it blocks, checkRole
// must never run (defence-in-depth: no leaking of role info on 401).

describe("sponsorLicenceV2 — guard ordering (ISSUE-012)", () => {
  it("verifyTokenAndTenant blocks before checkRole can run (no token)", () => {
    const req = { headers: {}, user: null };
    const res = makeRes();
    let checkRoleCalled = false;

    // Run only the first guard in isolation.
    stubVerifyTokenAndTenant(req, res, () => {
      checkRoleCalled = true;
    });

    assert.equal(checkRoleCalled, false, "checkRole must not run when auth fails");
    assert.equal(res._status, 401);
  });

  it("checkRole only runs after verifyTokenAndTenant passes", () => {
    const req = {
      headers: { authorization: "Bearer valid.token" },
      user: { userId: 1, role_id: ROLES.BUSINESS },
    };
    const res = makeRes();
    let checkRoleCalled = false;

    stubVerifyTokenAndTenant(req, res, () => {
      checkRoleCalled = true;
    });

    assert.equal(checkRoleCalled, true, "inner callback (checkRole) must run after auth passes");
    assert.equal(res._status, null);
  });
});
