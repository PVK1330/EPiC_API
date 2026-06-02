import test from 'node:test';
import assert from 'node:assert';
import {
  makeOAuthStateService,
  generateOAuthStateValue,
  OAUTH_STATE_TTL_MS,
} from '../src/services/oauthState.service.js';

/**
 * Tests for OAuth 2.0 CSRF state handling (Google + Microsoft).
 *
 * Covers: valid state, invalid/unknown state, replayed (single-use) state,
 * expired state, provider isolation, and that the random nonce never carries
 * the session token.
 *
 * Uses an injected in-memory fake of platformDb.OAuthState so no DB is needed.
 */

/** Minimal in-memory stand-in for platformDb.OAuthState (+ no transaction). */
function makeFakeDb() {
  const rows = new Map(); // state -> record
  return {
    rows,
    OAuthState: {
      async create(values) {
        if (rows.has(values.state)) {
          throw new Error('unique violation on state');
        }
        const record = {
          ...values,
          async destroy() {
            rows.delete(values.state);
          },
        };
        rows.set(values.state, record);
        return record;
      },
      async findOne({ where }) {
        const record = rows.get(where.state);
        if (!record) return null;
        if (where.provider && record.provider !== where.provider) return null;
        return record;
      },
    },
    // No sequelize.transaction -> service uses the non-transactional path.
  };
}

test('generateOAuthStateValue: 256-bit hex nonce, unique per call', () => {
  const a = generateOAuthStateValue();
  const b = generateOAuthStateValue();
  assert.match(a, /^[0-9a-f]{64}$/, 'must be 64 hex chars (32 random bytes)');
  assert.notStrictEqual(a, b, 'nonces must differ');
});

test('the random state never equals/contains the session token (no JWT in state)', async () => {
  const db = makeFakeDb();
  const svc = makeOAuthStateService(db);
  const token = 'eyJhbGciOi.JWT.SESSION.TOKEN.value';
  const state = await svc.createOAuthState({
    userId: 1, organisationId: 9, provider: 'google', authToken: token,
  });
  assert.notStrictEqual(state, token);
  assert.ok(!state.includes(token), 'state must not embed the token');
  // The token is held server-side, retrievable only by consuming the nonce.
  const session = await svc.consumeOAuthState(state, 'google');
  assert.strictEqual(session.authToken, token);
});

test('VALID state: consumes successfully and returns the bound session', async () => {
  const db = makeFakeDb();
  const svc = makeOAuthStateService(db);
  const state = await svc.createOAuthState({
    userId: 42, organisationId: 7, provider: 'google', authToken: 'tok-1',
  });
  const session = await svc.consumeOAuthState(state, 'google');
  assert.ok(session, 'valid state should resolve to a session');
  assert.strictEqual(session.userId, 42);
  assert.strictEqual(session.organisationId, 7);
  assert.strictEqual(session.provider, 'google');
});

test('INVALID state: unknown nonce is rejected', async () => {
  const db = makeFakeDb();
  const svc = makeOAuthStateService(db);
  assert.strictEqual(await svc.consumeOAuthState('does-not-exist', 'google'), null);
  assert.strictEqual(await svc.consumeOAuthState('', 'google'), null);
  assert.strictEqual(await svc.consumeOAuthState(undefined, 'google'), null);
});

test('REPLAYED state: a second consume of the same nonce is rejected (single use)', async () => {
  const db = makeFakeDb();
  const svc = makeOAuthStateService(db);
  const state = await svc.createOAuthState({
    userId: 5, provider: 'microsoft', authToken: 'tok-2',
  });
  const first = await svc.consumeOAuthState(state, 'microsoft');
  assert.ok(first, 'first use should succeed');
  const second = await svc.consumeOAuthState(state, 'microsoft');
  assert.strictEqual(second, null, 'replay must be rejected');
  assert.strictEqual(db.rows.size, 0, 'row must be deleted after use');
});

test('EXPIRED state: nonce older than the TTL is rejected (and still consumed)', async () => {
  const db = makeFakeDb();
  const svc = makeOAuthStateService(db);
  const issuedAt = 1_000_000;
  const state = await svc.createOAuthState({
    userId: 8, provider: 'google', authToken: 'tok-3', now: issuedAt,
  });
  // 10 minutes + 1s later.
  const later = issuedAt + OAUTH_STATE_TTL_MS + 1000;
  const session = await svc.consumeOAuthState(state, 'google', { now: later });
  assert.strictEqual(session, null, 'expired state must be rejected');
  assert.strictEqual(db.rows.size, 0, 'expired row must still be deleted');
});

test('state is valid right up to the TTL boundary', async () => {
  const db = makeFakeDb();
  const svc = makeOAuthStateService(db);
  const issuedAt = 2_000_000;
  const state = await svc.createOAuthState({
    userId: 8, provider: 'google', authToken: 'tok-4', now: issuedAt,
  });
  const justBefore = issuedAt + OAUTH_STATE_TTL_MS - 1; // 1ms before expiry
  const session = await svc.consumeOAuthState(state, 'google', { now: justBefore });
  assert.ok(session, 'state should still be valid just before expiry');
});

test('PROVIDER isolation: a google nonce cannot be consumed as microsoft', async () => {
  const db = makeFakeDb();
  const svc = makeOAuthStateService(db);
  const state = await svc.createOAuthState({
    userId: 3, provider: 'google', authToken: 'tok-5',
  });
  const wrong = await svc.consumeOAuthState(state, 'microsoft');
  assert.strictEqual(wrong, null, 'cross-provider use must be rejected');
});

test('createOAuthState rejects unsupported providers and missing userId', async () => {
  const db = makeFakeDb();
  const svc = makeOAuthStateService(db);
  await assert.rejects(() => svc.createOAuthState({ userId: 1, provider: 'facebook' }), /Unsupported/);
  await assert.rejects(() => svc.createOAuthState({ provider: 'google' }), /userId is required/);
});
