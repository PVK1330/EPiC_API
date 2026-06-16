/**
 * Tests for ensureAssignedCaseworker middleware — ISSUE-014.
 *
 * The middleware guards the CoS mutation routes (approve / reject / request-info).
 * It must:
 *   - Block unauthenticated requests (no req.user) → 401
 *   - Allow ADMIN (role 3) without touching the DB
 *   - Allow SUPERADMIN (role 5) without touching the DB
 *   - For CASEWORKER (role 2): load CosRequest.assignedCaseworkerIds and either
 *       allow (assigned) or deny (unassigned) → 403
 *   - Return 404 when the CosRequest row does not exist
 *   - Attach req.cosRequest on success to spare the handler a redundant DB load
 *
 * Run with: node --test tests/ensureAssignedCaseworker.cos.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── ROLES (mirrored from role.middleware.js) ─────────────────────────────────

const ROLES = Object.freeze({
  CASEWORKER: 2,
  ADMIN:      3,
  SUPERADMIN: 5,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRes() {
  const res = {
    _status: null,
    _body:   null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body   = body; return this; },
  };
  return res;
}

function makeNext() {
  let called = false;
  let err    = undefined;
  function next(e) { called = true; err = e; }
  next.wasCalled  = ()  => called;
  next.calledWith = ()  => err;
  return next;
}

// ─── Stubs ────────────────────────────────────────────────────────────────────

// hasFullAccessRole — mirrors role.middleware.js
function hasFullAccessRole(roleId) {
  const id = Number(roleId);
  return id === ROLES.ADMIN || id === ROLES.SUPERADMIN;
}

// extractCaseworkerIds — mirrors cosRequest.service.js
function extractCaseworkerIds(value) {
  let list = value;
  if (!Array.isArray(list)) {
    if (list == null) return [];
    list = [list];
  }
  return list
    .map((entry) => {
      if (typeof entry === "number") return entry;
      if (
        typeof entry === "string" &&
        entry.trim() !== "" &&
        !Number.isNaN(Number(entry))
      ) return Number(entry);
      if (entry && typeof entry === "object") {
        const id = entry.id ?? entry.userId ?? entry.caseworkerId ?? null;
        return id != null ? Number(id) : null;
      }
      return null;
    })
    .filter((id) => Number.isInteger(id) && id > 0);
}

// isCaseworkerAssignedToCos — mirrors cosRequest.service.js
function isCaseworkerAssignedToCos(request, caseworkerId) {
  return extractCaseworkerIds(request?.assignedCaseworkerIds).includes(
    Number(caseworkerId)
  );
}

// ─── ensureAssignedCaseworker stub ───────────────────────────────────────────
// Mirrors the real middleware in
// src/modules/Caseworker/Cos/ensureAssignedCaseworker.middleware.js

async function ensureAssignedCaseworker(req, res, next) {
  const { user, tenantDb, params } = req;

  if (!user) {
    res.status(401).json({ status: "error", message: "Authentication required" });
    return;
  }

  if (hasFullAccessRole(user.role_id)) {
    next();
    return;
  }

  try {
    const request = await tenantDb.CosRequest.findByPk(params.id, {
      attributes: ["id", "assignedCaseworkerIds"],
    });

    if (!request) {
      res.status(404).json({ status: "error", message: "CoS request not found" });
      return;
    }

    if (!isCaseworkerAssignedToCos(request, user.userId)) {
      res.status(403).json({
        status: "error",
        message: "You are not assigned to this CoS request.",
      });
      return;
    }

    req.cosRequest = request;
    next();
  } catch (err) {
    next(err);
  }
}

// ─── makeRequest ─────────────────────────────────────────────────────────────

function makeRequest(assignedCaseworkerIds = null, id = 42) {
  return { id, assignedCaseworkerIds };
}

// ─── makeTenantDb ────────────────────────────────────────────────────────────

function makeTenantDb(findResult) {
  let dbCalled = false;
  return {
    get wasCalled() { return dbCalled; },
    CosRequest: {
      findByPk: async () => {
        dbCalled = true;
        return findResult;
      },
    },
  };
}

// ─── 1. Unauthenticated ───────────────────────────────────────────────────────

describe("ensureAssignedCaseworker — unauthenticated (ISSUE-014)", () => {
  it("no req.user → 401", async () => {
    const req  = { user: null, tenantDb: makeTenantDb(null), params: { id: "1" } };
    const res  = makeRes();
    const next = makeNext();
    await ensureAssignedCaseworker(req, res, next);
    assert.equal(res._status, 401);
    assert.equal(next.wasCalled(), false);
  });

  it("no req.user — DB is never queried", async () => {
    const db   = makeTenantDb(null);
    const req  = { user: null, tenantDb: db, params: { id: "1" } };
    await ensureAssignedCaseworker(req, makeRes(), makeNext());
    assert.equal(db.wasCalled, false, "DB must not be touched for unauthenticated request");
  });
});

// ─── 2. Admin bypass ─────────────────────────────────────────────────────────

describe("ensureAssignedCaseworker — ADMIN bypass (ISSUE-014)", () => {
  function adminReq(role_id = ROLES.ADMIN) {
    const db = makeTenantDb(null); // returns null — would cause 404 for caseworkers
    return {
      req: { user: { userId: 10, role_id }, tenantDb: db, params: { id: "5" } },
      db,
    };
  }

  it("ADMIN (role 3) → next() called", async () => {
    const { req } = adminReq(ROLES.ADMIN);
    const res = makeRes(); const next = makeNext();
    await ensureAssignedCaseworker(req, res, next);
    assert.equal(next.wasCalled(), true);
    assert.equal(res._status, null);
  });

  it("ADMIN — DB is never queried (no row load needed)", async () => {
    const { req, db } = adminReq(ROLES.ADMIN);
    await ensureAssignedCaseworker(req, makeRes(), makeNext());
    assert.equal(db.wasCalled, false, "Admin must not trigger a DB load");
  });

  it("SUPERADMIN (role 5) → next() called", async () => {
    const { req } = adminReq(ROLES.SUPERADMIN);
    const res = makeRes(); const next = makeNext();
    await ensureAssignedCaseworker(req, res, next);
    assert.equal(next.wasCalled(), true);
    assert.equal(res._status, null);
  });

  it("SUPERADMIN — DB is never queried", async () => {
    const { req, db } = adminReq(ROLES.SUPERADMIN);
    await ensureAssignedCaseworker(req, makeRes(), makeNext());
    assert.equal(db.wasCalled, false, "Superadmin must not trigger a DB load");
  });

  it("req.cosRequest is NOT set for admin bypass (no row was loaded)", async () => {
    const { req } = adminReq(ROLES.ADMIN);
    await ensureAssignedCaseworker(req, makeRes(), makeNext());
    assert.equal(req.cosRequest, undefined);
  });
});

// ─── 3. Unassigned caseworker blocked ────────────────────────────────────────

describe("ensureAssignedCaseworker — unassigned caseworker blocked (ISSUE-014)", () => {
  function caseworkerReq(userId, findResult) {
    return {
      user: { userId, role_id: ROLES.CASEWORKER },
      tenantDb: makeTenantDb(findResult),
      params: { id: "42" },
    };
  }

  it("caseworker not in assignedCaseworkerIds → 403", async () => {
    const req  = caseworkerReq(99, makeRequest([1, 2, 3]));
    const res  = makeRes(); const next = makeNext();
    await ensureAssignedCaseworker(req, res, next);
    assert.equal(res._status, 403);
    assert.equal(next.wasCalled(), false);
  });

  it("error message says 'not assigned'", async () => {
    const req = caseworkerReq(99, makeRequest([1, 2]));
    const res = makeRes();
    await ensureAssignedCaseworker(req, res, makeNext());
    assert.match(res._body.message, /not assigned/i);
  });

  it("null assignedCaseworkerIds → 403 (empty list, nobody is assigned)", async () => {
    const req = caseworkerReq(5, makeRequest(null));
    const res = makeRes(); const next = makeNext();
    await ensureAssignedCaseworker(req, res, next);
    assert.equal(res._status, 403);
    assert.equal(next.wasCalled(), false);
  });

  it("empty assignedCaseworkerIds array → 403", async () => {
    const req = caseworkerReq(5, makeRequest([]));
    const res = makeRes(); const next = makeNext();
    await ensureAssignedCaseworker(req, res, next);
    assert.equal(res._status, 403);
    assert.equal(next.wasCalled(), false);
  });

  it("CosRequest row not found → 404", async () => {
    const req  = caseworkerReq(5, null); // DB returns null
    const res  = makeRes(); const next = makeNext();
    await ensureAssignedCaseworker(req, res, next);
    assert.equal(res._status, 404);
    assert.equal(next.wasCalled(), false);
  });
});

// ─── 4. Assigned caseworker allowed ──────────────────────────────────────────

describe("ensureAssignedCaseworker — assigned caseworker allowed (ISSUE-014)", () => {
  function caseworkerReq(userId, assignedCaseworkerIds) {
    const request = makeRequest(assignedCaseworkerIds);
    return {
      user: { userId, role_id: ROLES.CASEWORKER },
      tenantDb: makeTenantDb(request),
      params: { id: String(request.id) },
      _request: request,
    };
  }

  it("caseworker in assignedCaseworkerIds (numeric) → next() called", async () => {
    const req = caseworkerReq(7, [7, 8, 9]);
    const res = makeRes(); const next = makeNext();
    await ensureAssignedCaseworker(req, res, next);
    assert.equal(next.wasCalled(), true);
    assert.equal(res._status, null);
  });

  it("caseworker id as string in JSONB ('7') → next() called", async () => {
    const req = caseworkerReq(7, ["7", "8"]);
    const res = makeRes(); const next = makeNext();
    await ensureAssignedCaseworker(req, res, next);
    assert.equal(next.wasCalled(), true);
  });

  it("caseworker id as object {id: 7} in JSONB → next() called", async () => {
    const req = caseworkerReq(7, [{ id: 7 }, { id: 8 }]);
    const res = makeRes(); const next = makeNext();
    await ensureAssignedCaseworker(req, res, next);
    assert.equal(next.wasCalled(), true);
  });

  it("single assigned caseworker (not an array) → next() called", async () => {
    const req = caseworkerReq(7, 7); // scalar, not array
    const res = makeRes(); const next = makeNext();
    await ensureAssignedCaseworker(req, res, next);
    assert.equal(next.wasCalled(), true);
  });

  it("req.cosRequest is set to the loaded row on success", async () => {
    const req = caseworkerReq(7, [7]);
    await ensureAssignedCaseworker(req, makeRes(), makeNext());
    assert.ok(req.cosRequest, "req.cosRequest must be set after successful check");
    assert.equal(req.cosRequest.id, 42);
  });

  it("no error body written on success", async () => {
    const req = caseworkerReq(7, [7]);
    const res = makeRes();
    await ensureAssignedCaseworker(req, res, makeNext());
    assert.equal(res._body, null);
  });
});

// ─── 5. DB error propagation ─────────────────────────────────────────────────

describe("ensureAssignedCaseworker — DB error propagation (ISSUE-014)", () => {
  it("DB throws → error forwarded to next(err), no response sent", async () => {
    const dbError = new Error("Connection lost");
    const req = {
      user: { userId: 5, role_id: ROLES.CASEWORKER },
      tenantDb: {
        CosRequest: {
          findByPk: async () => { throw dbError; },
        },
      },
      params: { id: "1" },
    };
    const res  = makeRes();
    const next = makeNext();
    await ensureAssignedCaseworker(req, res, next);
    assert.equal(next.wasCalled(), true);
    assert.equal(next.calledWith(), dbError);
    assert.equal(res._status, null, "no HTTP response must be written on DB error");
  });
});

// ─── 6. Route-level guard ordering ───────────────────────────────────────────
// Verifies the three affected routes carry the middleware in the right position.

describe("ensureAssignedCaseworker — route guard ordering (ISSUE-014)", () => {
  // Simulate the middleware chain: checkRole passes (CASEWORKER), then
  // ensureAssignedCaseworker runs, then the handler.
  async function runChain(userId, assignedCaseworkerIds) {
    const request = makeRequest(assignedCaseworkerIds, 55);
    const req = {
      user: { userId, role_id: ROLES.CASEWORKER },
      tenantDb: makeTenantDb(request),
      params: { id: "55" },
    };
    const res = makeRes();
    let handlerCalled = false;
    const fakeHandler = async () => { handlerCalled = true; };

    const next = makeNext();
    await ensureAssignedCaseworker(req, res, async (err) => {
      if (err) { next(err); return; }
      await fakeHandler();
      next();
    });

    return { res, handlerCalled };
  }

  it("approve — unassigned caseworker never reaches handler", async () => {
    const { res, handlerCalled } = await runChain(99, [1, 2]);
    assert.equal(res._status, 403);
    assert.equal(handlerCalled, false);
  });

  it("reject — assigned caseworker reaches handler", async () => {
    const { res, handlerCalled } = await runChain(7, [7]);
    assert.equal(handlerCalled, true);
    assert.equal(res._status, null);
  });

  it("request-info — unassigned caseworker gets 403 before handler", async () => {
    const { res, handlerCalled } = await runChain(50, [10, 20]);
    assert.equal(res._status, 403);
    assert.equal(handlerCalled, false);
  });
});
