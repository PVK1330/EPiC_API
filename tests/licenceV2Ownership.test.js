/**
 * Ownership-enforcement tests for the V2 licence application flow.
 *
 * Covers two layers:
 *
 *   1. loadFullApplication() (service)
 *      Verifies that passing ownerUserId:null / 0 / -1 / NaN / "3" throws a
 *      401, while undefined (admin path) or a valid positive integer passes.
 *
 *   2. Sponsor controller handlers (getApplication, submitApplication,
 *      saveDraft, uploadAppendixDocument, deleteDraft)
 *      Verifies that every handler returns 401 when uid(req) resolves to null,
 *      and does NOT call tenantDb before the guard fires.
 *
 * Run with:  node --test tests/licenceV2Ownership.test.js
 */

import test from "node:test";
import assert from "node:assert";

import { loadFullApplication } from "../src/services/licenceApplicationV2.service.js";
import {
  getApplication,
  submitApplication,
  saveDraft,
  uploadAppendixDocument,
  deleteDraft,
} from "../src/modules/Sponsor/Licence/sponsorLicenceV2.controller.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

function mockRes() {
  return {
    statusCode: 200,
    sent: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.sent = payload;
      return this;
    },
  };
}

/**
 * Build a minimal Express-like request.
 *
 * @param {object|null} user   - req.user (null = unauthenticated)
 * @param {object}      params - req.params
 * @param {object}      body   - req.validated.body
 */
function mockReq({ user = null, params = {}, body = {} } = {}) {
  let dbCallCount = 0;
  const tenantDb = {
    _callCount: () => dbCallCount,
    LicenceApplication: {
      findOne: async () => {
        dbCallCount++;
        return null;
      },
      findAll: async () => {
        dbCallCount++;
        return [];
      },
    },
    LicenceApplicationRoute: {},
    LicenceOrganisationInfo: {},
    LicenceCosRequirement: {},
    LicenceAppendixDocument: {
      findOne: async () => {
        dbCallCount++;
        return null;
      },
    },
    LicenceAuthorisingOfficer: {},
    LicenceKeyContact: {},
    LicenceLevel1User: {},
    LicenceDeclaration: {},
    User: {},
  };

  return {
    user,
    params,
    validated: { body },
    tenantDb,
    file: null,
    method: "GET",
    originalUrl: "/api/business/licence/v2/applications/99",
  };
}

// ─── 1. loadFullApplication — ownerUserId validation ─────────────────────────

test("loadFullApplication: ownerUserId=null throws 401", async () => {
  const mockDb = {
    LicenceApplication: { findOne: async () => null },
    LicenceApplicationRoute: {},
    LicenceOrganisationInfo: {},
    LicenceCosRequirement: {},
    LicenceAppendixDocument: {},
    LicenceAuthorisingOfficer: {},
    LicenceKeyContact: {},
    LicenceLevel1User: {},
    LicenceDeclaration: {},
    User: {},
  };
  await assert.rejects(
    () => loadFullApplication(mockDb, 1, { ownerUserId: null }),
    (err) => {
      assert.strictEqual(err.statusCode, 401);
      assert.ok(
        err.message.toLowerCase().includes("positive integer"),
        `message should mention "positive integer": ${err.message}`,
      );
      return true;
    },
    "ownerUserId:null must throw 401",
  );
});

test("loadFullApplication: ownerUserId=0 throws 401", async () => {
  const mockDb = { LicenceApplication: { findOne: async () => null }, LicenceApplicationRoute: {}, LicenceOrganisationInfo: {}, LicenceCosRequirement: {}, LicenceAppendixDocument: {}, LicenceAuthorisingOfficer: {}, LicenceKeyContact: {}, LicenceLevel1User: {}, LicenceDeclaration: {}, User: {} };
  await assert.rejects(
    () => loadFullApplication(mockDb, 1, { ownerUserId: 0 }),
    (err) => { assert.strictEqual(err.statusCode, 401); return true; },
    "ownerUserId:0 must throw 401",
  );
});

test("loadFullApplication: ownerUserId=-1 throws 401", async () => {
  const mockDb = { LicenceApplication: { findOne: async () => null }, LicenceApplicationRoute: {}, LicenceOrganisationInfo: {}, LicenceCosRequirement: {}, LicenceAppendixDocument: {}, LicenceAuthorisingOfficer: {}, LicenceKeyContact: {}, LicenceLevel1User: {}, LicenceDeclaration: {}, User: {} };
  await assert.rejects(
    () => loadFullApplication(mockDb, 1, { ownerUserId: -1 }),
    (err) => { assert.strictEqual(err.statusCode, 401); return true; },
    "ownerUserId:-1 must throw 401",
  );
});

test("loadFullApplication: ownerUserId=NaN throws 401", async () => {
  const mockDb = { LicenceApplication: { findOne: async () => null }, LicenceApplicationRoute: {}, LicenceOrganisationInfo: {}, LicenceCosRequirement: {}, LicenceAppendixDocument: {}, LicenceAuthorisingOfficer: {}, LicenceKeyContact: {}, LicenceLevel1User: {}, LicenceDeclaration: {}, User: {} };
  await assert.rejects(
    () => loadFullApplication(mockDb, 1, { ownerUserId: NaN }),
    (err) => { assert.strictEqual(err.statusCode, 401); return true; },
    "ownerUserId:NaN must throw 401",
  );
});

test("loadFullApplication: ownerUserId='3' (string from JWT) throws 401", async () => {
  const mockDb = { LicenceApplication: { findOne: async () => null }, LicenceApplicationRoute: {}, LicenceOrganisationInfo: {}, LicenceCosRequirement: {}, LicenceAppendixDocument: {}, LicenceAuthorisingOfficer: {}, LicenceKeyContact: {}, LicenceLevel1User: {}, LicenceDeclaration: {}, User: {} };
  await assert.rejects(
    () => loadFullApplication(mockDb, 1, { ownerUserId: "3" }),
    (err) => { assert.strictEqual(err.statusCode, 401); return true; },
    "ownerUserId string '3' must throw 401 — must be a number",
  );
});

test("loadFullApplication: ownerUserId=undefined skips filter (admin path)", async () => {
  let capturedWhere = null;
  const mockDb = {
    LicenceApplication: {
      findOne: async ({ where }) => {
        capturedWhere = where;
        return null;
      },
    },
    LicenceApplicationRoute: {},
    LicenceOrganisationInfo: {},
    LicenceCosRequirement: {},
    LicenceAppendixDocument: {},
    LicenceAuthorisingOfficer: {},
    LicenceKeyContact: {},
    LicenceLevel1User: {},
    LicenceDeclaration: {},
    User: {},
  };
  await loadFullApplication(mockDb, 1);  // no ownerUserId
  assert.ok(capturedWhere !== null, "findOne should have been called");
  assert.ok(!("userId" in capturedWhere), "WHERE must not contain userId for admin path");
});

test("loadFullApplication: ownerUserId=1 adds userId to WHERE", async () => {
  let capturedWhere = null;
  const mockDb = {
    LicenceApplication: {
      findOne: async ({ where }) => {
        capturedWhere = where;
        return null;
      },
    },
    LicenceApplicationRoute: {},
    LicenceOrganisationInfo: {},
    LicenceCosRequirement: {},
    LicenceAppendixDocument: {},
    LicenceAuthorisingOfficer: {},
    LicenceKeyContact: {},
    LicenceLevel1User: {},
    LicenceDeclaration: {},
    User: {},
  };
  await loadFullApplication(mockDb, 1, { ownerUserId: 1 });
  assert.strictEqual(capturedWhere.userId, 1, "WHERE must contain userId=1");
});

test("loadFullApplication: explicit {} options skips filter (admin path)", async () => {
  let capturedWhere = null;
  const mockDb = {
    LicenceApplication: {
      findOne: async ({ where }) => {
        capturedWhere = where;
        return null;
      },
    },
    LicenceApplicationRoute: {},
    LicenceOrganisationInfo: {},
    LicenceCosRequirement: {},
    LicenceAppendixDocument: {},
    LicenceAuthorisingOfficer: {},
    LicenceKeyContact: {},
    LicenceLevel1User: {},
    LicenceDeclaration: {},
    User: {},
  };
  await loadFullApplication(mockDb, 1, {});
  assert.ok(!("userId" in capturedWhere), "WHERE must not contain userId for admin path (empty opts)");
});

// ─── 2. Controller handlers — null userId returns 401 before any DB call ──────

const NULL_USER_CASES = [
  { label: "null user",              user: null },
  { label: "missing userId field",   user: { email: "x@test.com", role_id: 4 } },
  { label: "userId = 0",             user: { userId: 0,    role_id: 4 } },
  { label: "userId = -1",            user: { userId: -1,   role_id: 4 } },
  { label: "userId = NaN",           user: { userId: NaN,  role_id: 4 } },
  { label: "userId = 'abc' (string)",user: { userId: "abc",role_id: 4 } },
  { label: "userId = null",          user: { userId: null, role_id: 4 } },
];

for (const { label, user } of NULL_USER_CASES) {
  test(`getApplication: ${label} → 401, no DB call`, async () => {
    const req = mockReq({ user, params: { id: "99" } });
    const res = mockRes();
    await getApplication(req, res);
    assert.strictEqual(res.statusCode, 401, `expected 401, got ${res.statusCode}`);
    assert.strictEqual(req.tenantDb._callCount(), 0, "DB must not be called before auth guard");
  });

  test(`submitApplication: ${label} → 401, no DB call`, async () => {
    const req = mockReq({ user, params: { id: "99" } });
    const res = mockRes();
    await submitApplication(req, res);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(req.tenantDb._callCount(), 0);
  });

  test(`saveDraft: ${label} → 401, no DB call`, async () => {
    const req = mockReq({ user, params: { id: "99" }, body: {} });
    const res = mockRes();
    await saveDraft(req, res);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(req.tenantDb._callCount(), 0);
  });

  test(`uploadAppendixDocument: ${label} → 401, no DB call`, async () => {
    const req = mockReq({ user, params: { id: "99", docId: "1" } });
    const res = mockRes();
    await uploadAppendixDocument(req, res);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(req.tenantDb._callCount(), 0);
  });

  test(`deleteDraft: ${label} → 401, no DB call`, async () => {
    const req = mockReq({ user, params: { id: "99" } });
    const res = mockRes();
    await deleteDraft(req, res);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(req.tenantDb._callCount(), 0);
  });
}

// ─── 3. Valid session passes through the guard (regression) ───────────────────

test("getApplication: valid userId passes guard and reaches DB", async () => {
  const req = mockReq({ user: { userId: 42, role_id: 4, organisation_id: 1 }, params: { id: "99" } });
  const res = mockRes();
  await getApplication(req, res);
  // DB was called (returns null → 404); important thing is guard passed
  assert.strictEqual(res.statusCode, 404, "should 404 when app not found, not 401");
  assert.ok(req.tenantDb._callCount() > 0, "DB must have been called after valid session");
});

test("saveDraft: valid userId passes guard and reaches DB", async () => {
  const req = mockReq({ user: { userId: 7, role_id: 4, organisation_id: 1 }, params: { id: "99" }, body: {} });
  const res = mockRes();
  await saveDraft(req, res);
  assert.strictEqual(res.statusCode, 404);
  assert.ok(req.tenantDb._callCount() > 0);
});
