/**
 * Behavioural auth regression test.
 *
 * Drives the real Express app (no DB needed — an unauthenticated request is
 * rejected by verifyToken before any query runs) and asserts that protected
 * endpoints reject anonymous callers with 401/403 rather than reaching a
 * controller. The first two entries are the routers that once shipped with NO
 * auth guard and returned 500 to anonymous callers — this locks in the fix.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';

// Protected endpoints (GET) that must NOT be reachable without authentication.
// 401 = auth required; 403 = CSRF/role boundary — both mean "blocked".
const PROTECTED_GETS = [
  '/api/caseworker/visa-workers', // was unguarded -> 500; must be 401
  '/api/admin/esignature',        // was unguarded -> 500; must be 401
  '/api/admin/roles',
  '/api/admin/candidates',
  '/api/cases',
  '/api/tasks',
  '/api/business/dashboard',
  '/api/candidate/dashboard',
  '/api/onboarding/steps',         // was anonymous 200; must be 401
  '/api/superadmin/organisations',
  '/api/notifications',
];

for (const path of PROTECTED_GETS) {
  test(`GET ${path} rejects unauthenticated access`, async () => {
    const res = await request(app).get(path).set('Origin', 'http://localhost:5173');
    assert.ok(
      res.status === 401 || res.status === 403,
      `Expected 401/403 for unauthenticated GET ${path}, got ${res.status}. ` +
        `A 200/404/500 here means the auth guard did not run.`,
    );
  });
}

// Public endpoints must stay reachable without a token.
test('GET /health is public', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
});
