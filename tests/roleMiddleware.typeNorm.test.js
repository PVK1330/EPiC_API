/**
 * Tests for the type-normalisation fix in role.middleware.js.
 *
 * JWT libraries commonly serialise numeric fields as strings ("3" instead of 3).
 * Before the fix, checkRole and ensureSelfOrRole used strict Array.includes()
 * without coercing req.user.role_id, so a string "3" never matched the numeric
 * ROLES.ADMIN (3) constant.  These tests cover:
 *
 *   1. hasFullAccessRole   — already correct, regression-only
 *   2. checkRole           — string form, numeric form, invalid values
 *   3. ensureSelfOrRole    — string form, NaN fallthrough, self-access, IDOR
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  checkRole,
  ensureSelfOrRole,
  hasFullAccessRole,
  ROLES,
} from '../src/middlewares/role.middleware.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockRes() {
  return {
    statusCode: 200,
    sent: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.sent = payload; return this; },
  };
}

/**
 * Build a minimal Express-like request.  Pass `user: null` to simulate an
 * unauthenticated request.  Pass a `user` object to set role_id precisely.
 */
function mockReq({ user = null, params = {} } = {}) {
  return {
    user,
    params,
    method: 'GET',
    originalUrl: '/api/test',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    tenantDb: { AuditLog: { create: async () => ({}) } },
  };
}

async function run(middleware, req, res) {
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  return nextCalled;
}

const STAFF = [ROLES.ADMIN, ROLES.CASEWORKER];

// ─── 1. hasFullAccessRole ─────────────────────────────────────────────────────

test('hasFullAccessRole: numeric ADMIN (3) → true', () => {
  assert.strictEqual(hasFullAccessRole(3), true);
});

test('hasFullAccessRole: numeric SUPERADMIN (5) → true', () => {
  assert.strictEqual(hasFullAccessRole(5), true);
});

test('hasFullAccessRole: string "3" (ADMIN from JWT) → true', () => {
  assert.strictEqual(hasFullAccessRole("3"), true);
});

test('hasFullAccessRole: string "5" (SUPERADMIN from JWT) → true', () => {
  assert.strictEqual(hasFullAccessRole("5"), true);
});

test('hasFullAccessRole: string "2" (CASEWORKER) → false', () => {
  assert.strictEqual(hasFullAccessRole("2"), false);
});

test('hasFullAccessRole: null → false', () => {
  assert.strictEqual(hasFullAccessRole(null), false);
});

test('hasFullAccessRole: undefined → false', () => {
  assert.strictEqual(hasFullAccessRole(undefined), false);
});

test('hasFullAccessRole: non-numeric string "admin" → false', () => {
  assert.strictEqual(hasFullAccessRole("admin"), false);
});

// ─── 2. checkRole — type normalisation (the core fix) ────────────────────────

test('checkRole: string "3" (ADMIN from JWT) passes when ROLES.ADMIN is allowed', async () => {
  const req = mockReq({ user: { id: 99, userId: 99, role_id: "3" } });
  const res = mockRes();
  const allowed = await run(checkRole([ROLES.ADMIN]), req, res);
  assert.strictEqual(allowed, true, 'string "3" must match numeric ROLES.ADMIN (3)');
  assert.strictEqual(res.statusCode, 200);
});

test('checkRole: string "2" (CASEWORKER from JWT) passes when ROLES.CASEWORKER is allowed', async () => {
  const req = mockReq({ user: { id: 50, userId: 50, role_id: "2" } });
  const res = mockRes();
  const allowed = await run(checkRole(STAFF), req, res);
  assert.strictEqual(allowed, true, 'string "2" must match numeric ROLES.CASEWORKER (2)');
});

test('checkRole: string "4" (BUSINESS from JWT) passes when ROLES.BUSINESS is allowed', async () => {
  const req = mockReq({ user: { id: 10, userId: 10, role_id: "4" } });
  const res = mockRes();
  const allowed = await run(checkRole([ROLES.BUSINESS]), req, res);
  assert.strictEqual(allowed, true, 'string "4" must match numeric ROLES.BUSINESS (4)');
});

test('checkRole: string "5" (SUPERADMIN from JWT) passes when ROLES.SUPERADMIN is allowed', async () => {
  const req = mockReq({ user: { id: 1, userId: 1, role_id: "5" } });
  const res = mockRes();
  const allowed = await run(checkRole([ROLES.SUPERADMIN]), req, res);
  assert.strictEqual(allowed, true, 'string "5" must match numeric ROLES.SUPERADMIN (5)');
});

test('checkRole: numeric role_id still works after fix (regression)', async () => {
  const req = mockReq({ user: { id: 99, userId: 99, role_id: ROLES.ADMIN } });
  const res = mockRes();
  const allowed = await run(checkRole([ROLES.ADMIN]), req, res);
  assert.strictEqual(allowed, true, 'numeric ROLES.ADMIN must continue to pass');
});

test('checkRole: string "1" (CANDIDATE) denied on STAFF-only route', async () => {
  const req = mockReq({ user: { id: 7, userId: 7, role_id: "1" } });
  const res = mockRes();
  const allowed = await run(checkRole(STAFF), req, res);
  assert.strictEqual(allowed, false);
  assert.strictEqual(res.statusCode, 403);
});

// ─── 3. checkRole — defensive validation for non-numeric role IDs ─────────────

const INVALID_ROLE_CASES = [
  ['null',             null],
  ['undefined',        undefined],
  ['non-numeric str',  "admin"],
  ['empty string',     ""],
  ['zero',             0],
  ['negative number',  -1],
  ['Infinity',         Infinity],
];

for (const [label, roleId] of INVALID_ROLE_CASES) {
  test(`checkRole: ${label} role_id → 403 with invalid-role message`, async () => {
    const req = mockReq({ user: { id: 1, userId: 1, role_id: roleId } });
    const res = mockRes();
    const allowed = await run(checkRole([ROLES.ADMIN]), req, res);
    assert.strictEqual(allowed, false, `role_id=${String(roleId)} must be blocked`);
    assert.strictEqual(res.statusCode, 403);
    // The response body must mention "invalid role" so the caller can distinguish
    // a malformed-token rejection from a plain "wrong role" 403.
    const body = JSON.stringify(res.sent ?? "");
    assert.ok(
      body.toLowerCase().includes("invalid role"),
      `response body should mention "invalid role"; got: ${body}`,
    );
  });
}

test('checkRole: missing req.user → 401 (unauthenticated)', async () => {
  const req = mockReq({ user: null });
  const res = mockRes();
  const allowed = await run(checkRole([ROLES.ADMIN]), req, res);
  assert.strictEqual(allowed, false);
  assert.strictEqual(res.statusCode, 401);
});

// ─── 4. ensureSelfOrRole — type normalisation ─────────────────────────────────

test('ensureSelfOrRole: string "3" (ADMIN from JWT) passes privileged path', async () => {
  const req = mockReq({ user: { id: 99, userId: 99, role_id: "3" }, params: { id: '7' } });
  const res = mockRes();
  const allowed = await run(ensureSelfOrRole(STAFF), req, res);
  assert.strictEqual(allowed, true, 'string "3" must grant unconditional access');
});

test('ensureSelfOrRole: string "2" (CASEWORKER from JWT) passes privileged path', async () => {
  const req = mockReq({ user: { id: 50, userId: 50, role_id: "2" }, params: { id: '7' } });
  const res = mockRes();
  const allowed = await run(ensureSelfOrRole(STAFF), req, res);
  assert.strictEqual(allowed, true, 'string "2" must grant unconditional access');
});

test('ensureSelfOrRole: numeric roles still work after fix (regression)', async () => {
  const req = mockReq({ user: { id: 99, userId: 99, role_id: ROLES.ADMIN }, params: { id: '7' } });
  const res = mockRes();
  const allowed = await run(ensureSelfOrRole(STAFF), req, res);
  assert.strictEqual(allowed, true, 'numeric ROLES.ADMIN must continue to pass');
});

test('ensureSelfOrRole: NaN role_id falls through to self-access (must not hard-block)', async () => {
  // A user whose JWT has a malformed role_id can still access their own resource
  // via the self-access path — ensureSelfOrRole should never hard-block solely on
  // a bad role; the role check failing just means no privileged bypass.
  const req = mockReq({ user: { id: 7, userId: 7, role_id: "notarole" }, params: { id: '7' } });
  const res = mockRes();
  const allowed = await run(ensureSelfOrRole(STAFF), req, res);
  assert.strictEqual(allowed, true, 'self-access must succeed even when role_id is NaN');
});

test('ensureSelfOrRole: NaN role_id + cross-user access → 403 (not a hard NaN block)', async () => {
  const req = mockReq({ user: { id: 7, userId: 7, role_id: "notarole" }, params: { id: '8' } });
  const res = mockRes();
  const allowed = await run(ensureSelfOrRole(STAFF), req, res);
  assert.strictEqual(allowed, false, 'cross-user access with invalid role must be denied');
  assert.strictEqual(res.statusCode, 403);
});

// ─── 5. ensureSelfOrRole — self-access and IDOR regressions ──────────────────

test('ensureSelfOrRole: CANDIDATE may access their OWN resource (regression)', async () => {
  const req = mockReq({ user: { id: 7, userId: 7, role_id: ROLES.CANDIDATE }, params: { id: '7' } });
  const res = mockRes();
  const allowed = await run(ensureSelfOrRole(STAFF), req, res);
  assert.strictEqual(allowed, true, 'candidate must reach their own record');
});

test('ensureSelfOrRole: CANDIDATE denied access to another user (IDOR regression)', async () => {
  const req = mockReq({ user: { id: 7, userId: 7, role_id: ROLES.CANDIDATE }, params: { id: '8' } });
  const res = mockRes();
  const allowed = await run(ensureSelfOrRole(STAFF), req, res);
  assert.strictEqual(allowed, false, 'IDOR: candidate must NOT reach another user');
  assert.strictEqual(res.statusCode, 403);
});

test('ensureSelfOrRole: string CANDIDATE "1" + self-access → allowed (string role_id)', async () => {
  const req = mockReq({ user: { id: 7, userId: 7, role_id: "1" }, params: { id: '7' } });
  const res = mockRes();
  const allowed = await run(ensureSelfOrRole(STAFF), req, res);
  // "1" is not in STAFF, but self-access should still pass.
  assert.strictEqual(allowed, true, 'self-access must work even when role_id arrives as a string');
});

test('ensureSelfOrRole: missing req.user → 401', async () => {
  const req = mockReq({ user: null, params: { id: '7' } });
  const res = mockRes();
  const allowed = await run(ensureSelfOrRole(STAFF), req, res);
  assert.strictEqual(allowed, false);
  assert.strictEqual(res.statusCode, 401);
});

test('ensureSelfOrRole: denied access is recorded in the audit log', async () => {
  let auditRow = null;
  const req = mockReq({ user: { id: 7, userId: 7, role_id: ROLES.CANDIDATE }, params: { id: '8' } });
  req.tenantDb = {
    AuditLog: {
      create: async (row) => { auditRow = row; return row; },
    },
  };
  const res = mockRes();
  await run(ensureSelfOrRole(STAFF), req, res);

  // recordAuditLog is fire-and-forget — drain the microtask queue.
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(auditRow, 'audit row must be written on a denied IDOR attempt');
  assert.strictEqual(auditRow.action, 'ACCESS_DENIED');
  assert.strictEqual(auditRow.status, 'Failed');
});
