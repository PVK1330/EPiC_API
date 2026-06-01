import test from 'node:test';
import assert from 'node:assert';
import { ensureSelfOrRole, checkRole, ROLES } from '../src/middlewares/role.middleware.js';

/**
 * Authorization tests for the Candidate module (IDOR / privilege escalation).
 *
 * These are unit tests over the middleware that guards candidate.routes.js.
 * They assert role-based access for admin/caseworker, candidate self-access,
 * and that a candidate is blocked (403) from reaching another candidate.
 */

const STAFF = [ROLES.ADMIN, ROLES.CASEWORKER];

function createMockResponse() {
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

/** Build a request with a fake tenantDb so denied-access audit logging is safe. */
function createReq({ user, params = {}, method = 'GET', path = '/api/candidates' }) {
  return {
    user,
    params,
    method,
    originalUrl: path,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    // No-op tenantDb so recordAuditLog can run without a real database.
    tenantDb: {
      AuditLog: {
        create: async () => ({}),
      },
    },
  };
}

/** Run a middleware and report whether next() was called. */
async function run(middleware, req, res) {
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  return nextCalled;
}

// ── 1. Admin access ─────────────────────────────────────────────────────────
test('checkRole: admin is allowed on staff-only candidate routes', async () => {
  const req = createReq({ user: { id: 99, userId: 99, role_id: ROLES.ADMIN } });
  const res = createMockResponse();
  const allowed = await run(checkRole(STAFF), req, res);
  assert.strictEqual(allowed, true, 'admin should pass checkRole');
  assert.strictEqual(res.statusCode, 200);
});

test('ensureSelfOrRole: admin may access any candidate application', async () => {
  // Admin acting on candidate id 7 (not their own id) — must be allowed.
  const req = createReq({ user: { id: 99, userId: 99, role_id: ROLES.ADMIN }, params: { id: '7' } });
  const res = createMockResponse();
  const allowed = await run(ensureSelfOrRole(STAFF), req, res);
  assert.strictEqual(allowed, true, 'admin should pass ensureSelfOrRole for any id');
});

// ── 2. Caseworker access ─────────────────────────────────────────────────────
test('checkRole: caseworker is allowed on staff-only candidate routes', async () => {
  const req = createReq({ user: { id: 50, userId: 50, role_id: ROLES.CASEWORKER } });
  const res = createMockResponse();
  const allowed = await run(checkRole(STAFF), req, res);
  assert.strictEqual(allowed, true, 'caseworker should pass checkRole');
});

test('ensureSelfOrRole: caseworker may access any candidate application', async () => {
  const req = createReq({ user: { id: 50, userId: 50, role_id: ROLES.CASEWORKER }, params: { id: '7' } });
  const res = createMockResponse();
  const allowed = await run(ensureSelfOrRole(STAFF), req, res);
  assert.strictEqual(allowed, true, 'caseworker should pass ensureSelfOrRole for any id');
});

// ── 3. Candidate self access ──────────────────────────────────────────────────
test('ensureSelfOrRole: candidate may access their OWN application', async () => {
  const req = createReq({
    user: { id: 7, userId: 7, role_id: ROLES.CANDIDATE },
    params: { id: '7' },
    method: 'PUT',
    path: '/api/candidates/7/application',
  });
  const res = createMockResponse();
  const allowed = await run(ensureSelfOrRole(STAFF), req, res);
  assert.strictEqual(allowed, true, 'candidate should access their own record');
  assert.strictEqual(res.statusCode, 200);
});

// ── 4. Candidate accessing ANOTHER candidate (IDOR) ──────────────────────────
test('ensureSelfOrRole: candidate is DENIED access to another candidate (403)', async () => {
  const req = createReq({
    user: { id: 7, userId: 7, role_id: ROLES.CANDIDATE },
    params: { id: '8' }, // someone else's id
    method: 'PUT',
    path: '/api/candidates/8/application',
  });
  const res = createMockResponse();
  const allowed = await run(ensureSelfOrRole(STAFF), req, res);
  assert.strictEqual(allowed, false, 'candidate must NOT reach another candidate');
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.sent.status, 'error');
});

test('checkRole: candidate is DENIED on staff-only routes (view/edit/delete/reset)', async () => {
  for (const method of ['GET', 'PATCH', 'DELETE', 'POST']) {
    const req = createReq({
      user: { id: 7, userId: 7, role_id: ROLES.CANDIDATE },
      params: { id: '8' },
      method,
    });
    const res = createMockResponse();
    const allowed = await run(checkRole(STAFF), req, res);
    assert.strictEqual(allowed, false, `candidate must be blocked on ${method}`);
    assert.strictEqual(res.statusCode, 403);
  }
});

test('ensureSelfOrRole: unauthenticated request is rejected (401)', async () => {
  const req = createReq({ user: null, params: { id: '7' } });
  const res = createMockResponse();
  const allowed = await run(ensureSelfOrRole(STAFF), req, res);
  assert.strictEqual(allowed, false);
  assert.strictEqual(res.statusCode, 401);
});

test('ensureSelfOrRole: denied access is recorded in the audit log', async () => {
  let auditWritten = null;
  const req = createReq({
    user: { id: 7, userId: 7, role_id: ROLES.CANDIDATE },
    params: { id: '8' },
    method: 'PUT',
    path: '/api/candidates/8/application',
  });
  req.tenantDb = {
    AuditLog: {
      create: async (row) => {
        auditWritten = row;
        return row;
      },
    },
  };
  const res = createMockResponse();
  await run(ensureSelfOrRole(STAFF), req, res);

  // recordAuditLog runs fire-and-forget; let the microtask queue drain.
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(auditWritten, 'an audit row should be written for the denied attempt');
  assert.strictEqual(auditWritten.action, 'ACCESS_DENIED');
  assert.strictEqual(auditWritten.status, 'Failed');
  assert.strictEqual(auditWritten.user_id, 7);
});
