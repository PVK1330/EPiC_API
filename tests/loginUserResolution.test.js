import test from 'node:test';
import assert from 'node:assert';
import { Op } from 'sequelize';
import { findPlatformUserForLogin } from '../src/utils/platformUserEmail.js';

/**
 * Regression tests for login user resolution.
 *
 * Bug: a sponsor (active, org-scoped) could not log in because a stale INACTIVE
 * duplicate of the same email with organisation_id = null shadowed it via the
 * "platform staff (org IS NULL)" branch, yielding a false
 * "Account is inactive or suspended."  Emails are unique per-org, not globally.
 */

/** In-memory fake of platformDb.User supporting the where shapes we use. */
function fakePlatformDb(rows) {
  const matches = (row, where) => {
    if (where.email !== undefined && row.email !== where.email) return false;
    if (where.role_id !== undefined && row.role_id !== where.role_id) return false;
    if (where.status !== undefined && row.status !== where.status) return false;
    if (where.organisation_id !== undefined) {
      const cond = where.organisation_id;
      if (cond !== null && typeof cond === 'object') {
        // { [Op.is]: null } → organisation_id must be null
        if (row.organisation_id != null) return false;
      } else if (row.organisation_id !== cond) {
        return false;
      }
    }
    return true;
  };
  return {
    User: {
      async findOne({ where, order } = {}) {
        let list = rows.filter((r) => matches(r, where));
        if (order?.[0]?.[0] === 'id') list = [...list].sort((a, b) => a.id - b.id);
        return list[0] || null;
      },
    },
  };
}

const SPONSOR_SCENARIO = [
  { id: 20, email: 'demo@gmail.com', role_id: 3, status: 'inactive', organisation_id: null },
  { id: 46, email: 'demo@gmail.com', role_id: 4, status: 'active', organisation_id: 19 },
];

test('no org context: active sponsor is returned, not the inactive org-null duplicate', async () => {
  const db = fakePlatformDb(SPONSOR_SCENARIO);
  const user = await findPlatformUserForLogin(db, 'demo@gmail.com', null);
  assert.ok(user, 'a user should be resolved');
  assert.strictEqual(user.id, 46, 'must pick the ACTIVE record, not the inactive shadow');
  assert.strictEqual(user.status, 'active');
});

test('org-scoped (subdomain) login returns the exact org record', async () => {
  const db = fakePlatformDb(SPONSOR_SCENARIO);
  const user = await findPlatformUserForLogin(db, 'demo@gmail.com', { organisation: { id: 19 } });
  assert.strictEqual(user.id, 46);
  assert.strictEqual(user.organisation_id, 19);
});

test('genuinely inactive sole account is still returned (correct error preserved)', async () => {
  const db = fakePlatformDb([
    { id: 5, email: 'x@y.com', role_id: 3, status: 'inactive', organisation_id: null },
  ]);
  const user = await findPlatformUserForLogin(db, 'x@y.com', null);
  assert.ok(user, 'inactive account must still resolve so login can report the right reason');
  assert.strictEqual(user.id, 5);
  assert.strictEqual(user.status, 'inactive');
});

test('superadmin takes precedence', async () => {
  const db = fakePlatformDb([
    { id: 1, email: 'boss@x.com', role_id: 5, status: 'active', organisation_id: null },
    { id: 2, email: 'boss@x.com', role_id: 4, status: 'active', organisation_id: 9 },
  ]);
  const user = await findPlatformUserForLogin(db, 'boss@x.com', null);
  assert.strictEqual(user.role_id, 5);
});

test('active platform-staff (org null) preferred over inactive platform-staff', async () => {
  const db = fakePlatformDb([
    { id: 1, email: 's@x.com', role_id: 3, status: 'inactive', organisation_id: null },
    { id: 2, email: 's@x.com', role_id: 3, status: 'active', organisation_id: null },
  ]);
  const user = await findPlatformUserForLogin(db, 's@x.com', null);
  assert.strictEqual(user.id, 2);
  assert.strictEqual(user.status, 'active');
});
