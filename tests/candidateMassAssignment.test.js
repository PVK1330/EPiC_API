import test from 'node:test';
import assert from 'node:assert';
import logger from '../src/utils/logger.js';
import {
  CandidateService,
  partitionCandidateUpdate,
  CANDIDATE_UPDATABLE_FIELDS,
  CANDIDATE_PROTECTED_FIELDS,
} from '../src/modules/Admin/Candidates/candidate.service.js';

/**
 * Mass-assignment protection tests for candidate updates.
 *
 * partitionCandidateUpdate() is the whitelist core; updateCandidate() is driven
 * against a fake tenantDb to prove protected fields are rejected (and logged),
 * unknown fields are dropped (and logged), and only whitelisted fields persist.
 */

// ── Whitelist core ───────────────────────────────────────────────────────────

test('partition: whitelisted profile fields pass through', () => {
  const data = {
    first_name: 'A', last_name: 'B', email: 'a@b.com',
    country_code: '+44', mobile: '7000', gender: 'female', profile_pic: 'x.png',
  };
  const { updateData, protectedAttempts, unknownFields } = partitionCandidateUpdate(data);
  assert.deepStrictEqual(updateData, data);
  assert.deepStrictEqual(protectedAttempts, []);
  assert.deepStrictEqual(unknownFields, []);
});

test('partition: protected fields are collected, never in updateData', () => {
  const { updateData, protectedAttempts } = partitionCandidateUpdate({
    first_name: 'A',
    role_id: 3,
    organisation_id: 99,
    status: 'active',
    password: 'pwn',
    is_email_verified: true,
    two_factor_enabled: false,
  });
  assert.deepStrictEqual(updateData, { first_name: 'A' });
  for (const f of ['role_id', 'organisation_id', 'status', 'password', 'is_email_verified', 'two_factor_enabled']) {
    assert.ok(protectedAttempts.includes(f), `${f} should be flagged protected`);
    assert.ok(!(f in updateData), `${f} must not be written`);
  }
});

test('partition: unknown fields are rejected (dropped), application ignored', () => {
  const { updateData, unknownFields } = partitionCandidateUpdate({
    last_name: 'B',
    hacker_field: 1,
    application: { visaType: 'X' },
  });
  assert.deepStrictEqual(updateData, { last_name: 'B' });
  assert.deepStrictEqual(unknownFields, ['hacker_field']);
});

test('whitelist and protected sets do not overlap', () => {
  const overlap = CANDIDATE_UPDATABLE_FIELDS.filter((f) => CANDIDATE_PROTECTED_FIELDS.includes(f));
  assert.deepStrictEqual(overlap, [], 'a field cannot be both updatable and protected');
});

// ── updateCandidate behavior ─────────────────────────────────────────────────

function makeTenantDb(candidate) {
  return {
    User: {
      findOne: async ({ where } = {}) => {
        // findById uses { id, role_id }; uniqueness lookups use { email } / { country_code, mobile }
        if (where && where.id !== undefined && where.role_id !== undefined) return candidate;
        return null; // no email/mobile conflict
      },
    },
    Role: undefined,
    CandidateApplication: undefined,
    Case: undefined,
    sequelize: { transaction: async (cb) => cb({ id: 'tx' }) },
  };
}

function makeCandidate() {
  return {
    id: 7,
    email: 'old@e.com',
    country_code: '+44',
    mobile: '700000',
    role_id: 1,
    written: null,
    async update(values) {
      this.written = values;
      Object.assign(this, values);
      return this;
    },
  };
}

test('updateCandidate REJECTS protected fields (throws + logs), never writes', async (t) => {
  const warnSpy = t.mock.method(logger, 'warn', () => {});
  const candidate = makeCandidate();
  const svc = new CandidateService(makeTenantDb(candidate));

  await assert.rejects(
    () => svc.updateCandidate(7, { first_name: 'Mallory', role_id: 3, status: 'active' }),
    /Cannot modify protected field\(s\): role_id, status/,
  );
  assert.strictEqual(candidate.written, null, 'no write may occur when protected fields are present');
  assert.ok(warnSpy.mock.callCount() >= 1, 'protected-field attempt must be logged');
  const logged = warnSpy.mock.calls[0].arguments[0];
  assert.deepStrictEqual(logged.fields.sort(), ['role_id', 'status']);
});

test('updateCandidate writes ONLY whitelisted fields and drops unknowns (logged)', async (t) => {
  const warnSpy = t.mock.method(logger, 'warn', () => {});
  const candidate = makeCandidate();
  const svc = new CandidateService(makeTenantDb(candidate));

  await svc.updateCandidate(7, { first_name: 'Alice', last_name: 'Smith', injected: 'evil' });

  assert.deepStrictEqual(candidate.written, { first_name: 'Alice', last_name: 'Smith' });
  assert.ok(!('injected' in candidate.written), 'unknown field must not be written');
  assert.ok(warnSpy.mock.callCount() >= 1, 'unknown field should be logged');
});

test('updateCandidate persists whitelisted email/mobile (regression: they were dropped before)', async (t) => {
  t.mock.method(logger, 'warn', () => {});
  const candidate = makeCandidate();
  const svc = new CandidateService(makeTenantDb(candidate));

  await svc.updateCandidate(7, { email: 'new@e.com', country_code: '+1', mobile: '555' });

  assert.strictEqual(candidate.written.email, 'new@e.com');
  assert.strictEqual(candidate.written.country_code, '+1');
  assert.strictEqual(candidate.written.mobile, '555');
});
