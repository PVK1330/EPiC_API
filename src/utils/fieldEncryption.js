/**
 * fieldEncryption.js
 * AES-256-GCM encryption helpers for sensitive PII fields stored in the database.
 *
 * Designed to be applied in Sequelize beforeCreate / beforeUpdate hooks so that
 * niNumber, passportNumber, brpNumber, nationalIdCardNumber, and similar values
 * are never written to the database in plaintext.
 *
 * Key: FIELD_ENCRYPTION_KEY — a 64-character hex string (32 bytes).
 * Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Stored format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 * The presence of two colons is used as the sentinel to detect already-encrypted
 * values, so raw plaintext (which will never contain two colons in standard PII
 * values like NI numbers or passport numbers) is safe to pass through decrypt()
 * and will be returned unchanged when no key is configured.
 *
 * Graceful degradation:
 *   - If FIELD_ENCRYPTION_KEY is not set, encrypt() returns the plaintext as-is
 *     and decrypt() returns the value as-is. This lets the server run in
 *     development without the key while making the gap visible in production
 *     via the startup validator.
 *   - If a value is already encrypted (detected by sentinel format) a second call
 *     to encrypt() is a no-op — safe to call from hooks on update.
 */

import crypto from 'crypto';
import logger from './logger.js';

const ALGO = 'aes-256-gcm';
const KEY_HEX_RE = /^[0-9a-fA-F]{64}$/;

/** Sentinel: three colon-delimited hex segments. */
const ENCRYPTED_RE = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;

/**
 * Derive the 32-byte AES key from FIELD_ENCRYPTION_KEY.
 * Returns null if the key is not set (graceful degradation in dev).
 * Throws if the key is present but malformed (misconfiguration, not missing).
 *
 * @returns {Buffer|null}
 */
function getKey() {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw || !raw.trim()) return null; // key not configured — degrade gracefully
  const trimmed = raw.trim();
  if (!KEY_HEX_RE.test(trimmed)) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return Buffer.from(trimmed, 'hex');
}

/**
 * Encrypt a plaintext PII value.
 *
 * @param {string|null|undefined} plaintext
 * @returns {string|null|undefined} "iv:tag:ciphertext" (all hex) or original value
 *   if plaintext is null/undefined/empty, or if FIELD_ENCRYPTION_KEY is not set.
 */
export function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return plaintext;

  // Already encrypted — no double-encryption.
  if (typeof plaintext === 'string' && ENCRYPTED_RE.test(plaintext)) return plaintext;

  const key = getKey();
  if (!key) {
    // Key not configured — warn once per process, return plaintext.
    if (!encrypt._warnedOnce) {
      logger.warn(
        'FIELD_ENCRYPTION_KEY is not set — sensitive PII fields will be stored unencrypted. ' +
          'Set FIELD_ENCRYPTION_KEY in your .env file for production use.',
      );
      encrypt._warnedOnce = true;
    }
    return plaintext;
  }

  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}
encrypt._warnedOnce = false;

/**
 * Decrypt a value produced by encrypt().
 *
 * @param {string|null|undefined} value
 * @returns {string|null|undefined} Plaintext, or the original value if:
 *   - it is null/undefined/empty,
 *   - it does not look like an encrypted value (pass-through for legacy plaintext rows),
 *   - FIELD_ENCRYPTION_KEY is not set,
 *   - decryption fails (logs an error and returns null in that case).
 */
export function decrypt(value) {
  if (value == null || value === '') return value;
  if (typeof value !== 'string') return value;

  // Not in encrypted format — return as-is (legacy plaintext or non-PII value).
  if (!ENCRYPTED_RE.test(value)) return value;

  const key = getKey();
  if (!key) return value; // key not configured — return raw (encrypted) value

  try {
    const [ivHex, tagHex, ctHex] = value.split(':');
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(ctHex, 'hex')),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  } catch (err) {
    logger.error({ err }, 'fieldEncryption: decryption failed — returning null');
    return null;
  }
}

/**
 * Convenience: encrypt a set of named fields on a plain object in-place.
 * Only encrypts fields whose value is a non-empty string.
 *
 * @param {object} obj  - The object to mutate (e.g. Sequelize instance.dataValues).
 * @param {string[]} fields - Field names to encrypt.
 * @returns {object} The same object, mutated.
 *
 * @example
 *   encryptFields(instance.dataValues, ['niNumber', 'passportNumber', 'brpNumber']);
 */
export function encryptFields(obj, fields) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const field of fields) {
    if (obj[field] != null && obj[field] !== '') {
      obj[field] = encrypt(obj[field]);
    }
  }
  return obj;
}

/**
 * Convenience: decrypt a set of named fields on a plain object in-place.
 *
 * @param {object} obj   - The object to mutate.
 * @param {string[]} fields - Field names to decrypt.
 * @returns {object} The same object, mutated.
 */
export function decryptFields(obj, fields) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const field of fields) {
    if (obj[field] != null && obj[field] !== '') {
      obj[field] = decrypt(obj[field]);
    }
  }
  return obj;
}

/**
 * List of PII field names across candidateApplication, sponsoredWorker, and
 * licenceAuthorisingOfficer that should be encrypted at rest.
 * Import this constant when wiring Sequelize model hooks.
 */
export const PII_FIELDS = [
  'niNumber',
  'ni_number',
  'passportNumber',
  'passport_number',
  'brpNumber',
  'brp_number',
  'nationalIdCardNumber',
  'nationalIdNumber',
];

export default { encrypt, decrypt, encryptFields, decryptFields, PII_FIELDS };
