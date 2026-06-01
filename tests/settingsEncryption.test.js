import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { encryptValue, decryptValue } from '../src/services/settings.service.js';
import { validateRequiredEnv } from '../src/utils/validateEnv.js';

/**
 * Tests for the dedicated secrets-at-rest key (SETTINGS_ENCRYPTION_KEY):
 *  - no fallback to JWT_SECRET
 *  - 64-hex (32-byte) format required
 *  - encrypt/decrypt round-trips under the dedicated key
 *  - a value encrypted under one key cannot be read with another
 *  - startup validation rejects missing / malformed / JWT-equal keys
 */

const KEY_A = crypto.randomBytes(32).toString('hex');
const KEY_B = crypto.randomBytes(32).toString('hex');

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('encrypt/decrypt round-trips under the dedicated key', () => {
  withEnv({ SETTINGS_ENCRYPTION_KEY: KEY_A }, () => {
    const secret = 'super-secret-oauth-client-secret';
    const cipher = encryptValue(secret);
    assert.notStrictEqual(cipher, secret);
    assert.match(cipher, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/, 'iv:tag:data hex format');
    assert.strictEqual(decryptValue(cipher), secret);
  });
});

test('NO fallback to JWT_SECRET: encryption fails when the dedicated key is unset', () => {
  withEnv({ SETTINGS_ENCRYPTION_KEY: undefined, JWT_SECRET: 'some-jwt-secret-value-long-enough' }, () => {
    assert.throws(() => encryptValue('x'), /SETTINGS_ENCRYPTION_KEY is not set/);
  });
});

test('malformed key (not 64 hex) is rejected at encryption time', () => {
  withEnv({ SETTINGS_ENCRYPTION_KEY: 'too-short' }, () => {
    assert.throws(() => encryptValue('x'), /64-character hex string/);
  });
});

test('a value encrypted with key A cannot be decrypted with key B', () => {
  const cipher = withEnv({ SETTINGS_ENCRYPTION_KEY: KEY_A }, () => encryptValue('rotate-me'));
  const out = withEnv({ SETTINGS_ENCRYPTION_KEY: KEY_B }, () => decryptValue(cipher));
  assert.strictEqual(out, null, 'wrong key must fail closed (null), not return plaintext');
});

test('startup validation passes with a valid, distinct dedicated key', () => {
  withEnv({ SETTINGS_ENCRYPTION_KEY: KEY_A, JWT_SECRET: 'a'.repeat(40) }, () => {
    assert.doesNotThrow(() =>
      validateRequiredEnv([
        {
          key: 'SETTINGS_ENCRYPTION_KEY',
          label: 'SETTINGS_ENCRYPTION_KEY',
          hint: '',
          validate: (v) =>
            /^[0-9a-fA-F]{64}$/.test(v.trim())
              ? (process.env.JWT_SECRET && v.trim() === process.env.JWT_SECRET.trim()
                  ? 'must NOT be the same value as JWT_SECRET'
                  : null)
              : 'must be a 64-character hex string (32 bytes)',
        },
      ]),
    );
  });
});

test('startup validation rejects a key equal to JWT_SECRET', () => {
  // validateRequiredEnv calls process.exit(1) on failure; stub it to capture.
  const realExit = process.exit;
  const realErr = console.error;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; throw new Error('__exit__'); };
  console.error = () => {};
  try {
    withEnv({ SETTINGS_ENCRYPTION_KEY: KEY_A, JWT_SECRET: KEY_A }, () => {
      assert.throws(
        () =>
          validateRequiredEnv([
            {
              key: 'SETTINGS_ENCRYPTION_KEY',
              label: 'SETTINGS_ENCRYPTION_KEY',
              hint: '',
              validate: (v) =>
                process.env.JWT_SECRET && v.trim() === process.env.JWT_SECRET.trim()
                  ? 'must NOT be the same value as JWT_SECRET'
                  : null,
            },
          ]),
        /__exit__/,
      );
    });
    assert.strictEqual(exitCode, 1, 'should abort startup with exit code 1');
  } finally {
    process.exit = realExit;
    console.error = realErr;
  }
});
