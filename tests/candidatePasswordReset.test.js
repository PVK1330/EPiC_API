import test from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import platformDb from '../src/models/index.js';
import { CandidateService } from '../src/modules/Admin/Candidates/candidate.service.js';
import { resetCandidatePasswordSchema } from '../src/validations/candidate.validation.js';

/**
 * Security tests for candidate password reset.
 *
 * Verifies:
 *  - the stored password is a bcrypt hash, never plaintext
 *  - login still works after reset (bcrypt.compare)
 *  - a platform-sync failure rolls back the tenant password update
 *  - the strong-password policy (min 12 + complexity) is enforced
 *
 * No live DB: `new Sequelize()` connects lazily, so platformDb.User is a real
 * model object we mock; the tenant side is a hand-rolled fake whose
 * sequelize.transaction restores state on throw to emulate a real rollback.
 */

const NEW_PASSWORD = 'Str0ng#Passw0rd!';
const OLD_HASH = '$2a$12$OLDoldOLDoldOLDoldOLDoldOLDoldOLDoldOLDoldOLDoldO';

/** Build a fake tenantDb + the candidate row it returns. */
function makeTenantDb() {
  const candidate = {
    id: 7,
    email: 'candidate@example.com',
    role_id: 1,
    password: OLD_HASH,
    async update(fields) {
      Object.assign(this, fields);
      return this;
    },
  };

  const tenantDb = {
    // findById() ignores the query and returns our candidate.
    User: { findOne: async () => candidate },
    sequelize: {
      // Emulate a managed transaction: snapshot, run, and on throw roll back.
      transaction: async (cb) => {
        const snapshot = { ...candidate };
        try {
          return await cb({ id: 'tx' });
        } catch (err) {
          Object.assign(candidate, snapshot); // rollback
          throw err;
        }
      },
    },
  };

  return { tenantDb, candidate };
}

test('reset stores a bcrypt hash, never the plaintext password', async (t) => {
  let platformUpdatePayload = null;
  t.mock.method(platformDb.User, 'update', async (updates) => {
    platformUpdatePayload = updates;
    return [1];
  });

  const { tenantDb, candidate } = makeTenantDb();
  const service = new CandidateService(tenantDb);
  const result = await service.resetCandidatePassword(7, NEW_PASSWORD);

  assert.strictEqual(result, true);
  // Tenant: stored value is a hash, not the plaintext.
  assert.notStrictEqual(candidate.password, NEW_PASSWORD, 'password must not be plaintext');
  assert.match(candidate.password, /^\$2[aby]\$12\$/, 'must be a bcrypt hash with cost 12');
  // Platform: synced value is the same hash, also not plaintext.
  assert.ok(platformUpdatePayload, 'platform user must be updated');
  assert.notStrictEqual(platformUpdatePayload.password, NEW_PASSWORD);
  assert.strictEqual(platformUpdatePayload.password, candidate.password);
});

test('login works after reset (bcrypt.compare succeeds for the new password)', async (t) => {
  t.mock.method(platformDb.User, 'update', async () => [1]);

  const { tenantDb, candidate } = makeTenantDb();
  const service = new CandidateService(tenantDb);
  await service.resetCandidatePassword(7, NEW_PASSWORD);

  assert.strictEqual(await bcrypt.compare(NEW_PASSWORD, candidate.password), true,
    'correct password must verify');
  assert.strictEqual(await bcrypt.compare('wrong-password', candidate.password), false,
    'wrong password must not verify');
});

test('transaction rolls back the tenant password when platform sync fails', async (t) => {
  t.mock.method(platformDb.User, 'update', async () => {
    throw new Error('platform sync failed');
  });

  const { tenantDb, candidate } = makeTenantDb();
  const service = new CandidateService(tenantDb);

  await assert.rejects(
    () => service.resetCandidatePassword(7, NEW_PASSWORD),
    /platform sync failed/,
  );

  // The tenant password must be unchanged (rolled back to the original hash).
  assert.strictEqual(candidate.password, OLD_HASH, 'tenant password must be rolled back');
});

test('reset throws for an unknown candidate', async (t) => {
  t.mock.method(platformDb.User, 'update', async () => [1]);
  const tenantDb = {
    User: { findOne: async () => null },
    sequelize: { transaction: async (cb) => cb({}) },
  };
  const service = new CandidateService(tenantDb);
  await assert.rejects(() => service.resetCandidatePassword(999, NEW_PASSWORD), /Candidate not found/);
});

test('strong-password policy: min length 12 + complexity is enforced', () => {
  const ok = resetCandidatePasswordSchema.safeParse({
    params: { id: 7 },
    body: { new_password: NEW_PASSWORD, confirm_password: NEW_PASSWORD },
  });
  assert.strictEqual(ok.success, true, 'a strong, matching password should pass');

  const cases = [
    { new_password: 'Short1!', confirm_password: 'Short1!', why: 'too short (<12)' },
    { new_password: 'alllowercase1!', confirm_password: 'alllowercase1!', why: 'no uppercase' },
    { new_password: 'ALLUPPERCASE1!', confirm_password: 'ALLUPPERCASE1!', why: 'no lowercase' },
    { new_password: 'NoDigitsHere!!', confirm_password: 'NoDigitsHere!!', why: 'no digit' },
    { new_password: 'NoSpecial1234', confirm_password: 'NoSpecial1234', why: 'no special char' },
    { new_password: NEW_PASSWORD, confirm_password: 'Different#123', why: 'mismatch' },
  ];
  for (const c of cases) {
    const res = resetCandidatePasswordSchema.safeParse({ params: { id: 7 }, body: c });
    assert.strictEqual(res.success, false, `should reject: ${c.why}`);
  }
});
