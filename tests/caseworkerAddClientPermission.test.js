import test from 'node:test';
import assert from 'node:assert';
import { checkRole, checkAnyPermission, ROLES } from '../src/middlewares/role.middleware.js';

const STAFF = [ROLES.ADMIN, ROLES.CASEWORKER];
const CLIENT_CREATE_PERMISSIONS = ["admin.candidates.create", "caseworker.candidates.create"];

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

function createReq({ user, method = 'POST', path = '/api/admin/candidates' }) {
  return {
    user,
    method,
    originalUrl: path,
    headers: {},
  };
}

async function run(middleware, req, res) {
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  return nextCalled;
}

test('Admin is allowed to add clients unconditionally (full access bypass)', async () => {
  const req = createReq({ user: { id: 1, role_id: ROLES.ADMIN, permissions: [] } });
  const res = createMockResponse();

  const roleAllowed = await run(checkRole(STAFF), req, res);
  assert.strictEqual(roleAllowed, true, 'Admin should pass checkRole(STAFF)');

  const permAllowed = await run(checkAnyPermission(CLIENT_CREATE_PERMISSIONS), req, res);
  assert.strictEqual(permAllowed, true, 'Admin should pass checkAnyPermission');
  assert.strictEqual(res.statusCode, 200);
});

test('Selected Caseworker with caseworker.candidates.create permission is ALLOWED to add clients', async () => {
  const req = createReq({
    user: {
      id: 20,
      role_id: ROLES.CASEWORKER,
      can_add_clients: true,
      permissions: ['caseworker.cases.view', 'caseworker.candidates.create'],
    },
  });
  const res = createMockResponse();

  const roleAllowed = await run(checkRole(STAFF), req, res);
  assert.strictEqual(roleAllowed, true, 'Caseworker should pass checkRole(STAFF)');

  const permAllowed = await run(checkAnyPermission(CLIENT_CREATE_PERMISSIONS), req, res);
  assert.strictEqual(permAllowed, true, 'Permitted caseworker should pass checkAnyPermission');
  assert.strictEqual(res.statusCode, 200);
});

test('Standard Caseworker WITHOUT caseworker.candidates.create permission is DENIED (403)', async () => {
  const req = createReq({
    user: {
      id: 21,
      role_id: ROLES.CASEWORKER,
      can_add_clients: false,
      permissions: ['caseworker.cases.view', 'caseworker.candidates.view'],
    },
  });
  const res = createMockResponse();

  const roleAllowed = await run(checkRole(STAFF), req, res);
  assert.strictEqual(roleAllowed, true, 'Caseworker should pass checkRole(STAFF)');

  const permAllowed = await run(checkAnyPermission(CLIENT_CREATE_PERMISSIONS), req, res);
  assert.strictEqual(permAllowed, false, 'Unpermitted caseworker must be denied');
  assert.strictEqual(res.statusCode, 403);
});

test('Candidate role is completely DENIED by checkRole(STAFF) (403)', async () => {
  const req = createReq({
    user: {
      id: 99,
      role_id: ROLES.CANDIDATE,
      permissions: ['candidate.application.view'],
    },
  });
  const res = createMockResponse();

  const roleAllowed = await run(checkRole(STAFF), req, res);
  assert.strictEqual(roleAllowed, false, 'Candidate must be denied on STAFF check');
  assert.strictEqual(res.statusCode, 403);
});
