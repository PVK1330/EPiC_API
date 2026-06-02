/**
 * settings.service.js
 * Helpers for reading/writing platform_settings key-value rows.
 *
 * Sensitive values (SMTP password, S3 keys, OAuth client secrets, OAuth tokens)
 * are encrypted at rest with AES-256-GCM using a DEDICATED key,
 * SETTINGS_ENCRYPTION_KEY (a 64-char hex string = 32 bytes).
 *
 * SECURITY: there is intentionally NO fallback to JWT_SECRET. Reusing the JWT
 * signing secret as the encryption key means a single secret compromise yields
 * both session forgery AND decryption of every stored OAuth secret/token. The
 * key is mandatory and validated at startup by validateEnv.js. Generate one
 * with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import crypto from "crypto";
import platformDb from "../models/index.js";

const { PlatformSetting } = platformDb;

// ---------------------------------------------------------------------------
// Encryption helpers (AES-256-GCM)
// ---------------------------------------------------------------------------

const ALGO = "aes-256-gcm";
const MASK = "••••••••";
const KEY_HEX_RE = /^[0-9a-fA-F]{64}$/; // 32 bytes, hex-encoded

/**
 * Derive the 32-byte AES key from SETTINGS_ENCRYPTION_KEY.
 *
 * Mandatory dedicated key — NO fallback to JWT_SECRET. Must be a 64-char hex
 * string (32 bytes). Throws if missing or malformed (belt-and-suspenders;
 * validateEnv.js already aborts startup, so this should never fire at runtime).
 */
function getDerivedKey() {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!raw || !raw.trim()) {
    throw new Error(
      "SETTINGS_ENCRYPTION_KEY is not set. Server startup should have been aborted by validateEnv.js. " +
        "Set a dedicated 64-char hex key (32 bytes) and restart.",
    );
  }
  const trimmed = raw.trim();
  if (!KEY_HEX_RE.test(trimmed)) {
    throw new Error(
      "SETTINGS_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). " +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return Buffer.from(trimmed, "hex");
}

/**
 * Encrypt a plaintext string.
 * Returns a colon-delimited string: "iv:authTag:ciphertext" (all hex).
 */
export function encryptValue(plain) {
  if (plain == null || plain === "") return plain;
  const key = getDerivedKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a value produced by encryptValue().
 * Returns the original plaintext, or null if decryption fails.
 */
export function decryptValue(cipher) {
  if (!cipher || typeof cipher !== "string") return null;
  // Not an encrypted value (legacy plain-text or empty)
  if (!cipher.includes(":")) return cipher;
  try {
    const [ivHex, tagHex, dataHex] = cipher.split(":");
    const key = getDerivedKey();
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    // Decryption failure — return null so callers can handle gracefully
    return null;
  }
}

/** Replace a secret value with the mask string for API responses. */
export function maskValue() {
  return MASK;
}

/** Returns true if a stored value looks like our encrypted format. */
function isEncrypted(val) {
  if (!val || typeof val !== "string") return false;
  const parts = val.split(":");
  return parts.length === 3 && /^[0-9a-f]+$/i.test(parts[0]);
}

// ---------------------------------------------------------------------------
// Keys that must be encrypted at rest
// ---------------------------------------------------------------------------
const SENSITIVE_KEYS = new Set([
  "smtp.password",
  "s3.secret_key",
  "s3.access_key",
]);

// ---------------------------------------------------------------------------
// Core DB helpers
// ---------------------------------------------------------------------------

/**
 * Fetch all platform_settings rows whose key starts with `namespace.`
 * (or all rows if namespace is null/undefined).
 * Returns a plain object: { key_without_namespace: value }.
 * Sensitive values are decrypted before returning.
 */
export async function getSettingsByNamespace(namespace) {
  const rows = await PlatformSetting.findAll();

  const result = {};
  for (const row of rows) {
    const { key, value } = row;

    if (namespace && !key.startsWith(`${namespace}.`)) continue;

    const shortKey = namespace ? key.slice(namespace.length + 1) : key;
    const isSensitive = SENSITIVE_KEYS.has(key);

    if (isSensitive && isEncrypted(value)) {
      result[shortKey] = decryptValue(value);
    } else {
      result[shortKey] = value;
    }
  }

  return result;
}

/**
 * Upsert a single key-value pair into platform_settings.
 * Automatically encrypts sensitive keys before persisting.
 */
export async function upsertSetting(key, value) {
  const isSensitive = SENSITIVE_KEYS.has(key);
  const stored = isSensitive ? encryptValue(String(value ?? "")) : String(value ?? "");

  const [row, created] = await PlatformSetting.findOrCreate({
    where: { key },
    defaults: { key, value: stored },
  });

  if (!created) {
    await row.update({ value: stored });
  }

  return row;
}

/**
 * Upsert multiple key-value pairs under a namespace prefix.
 * e.g. upsertNamespacedSettings("smtp", { host: "...", password: "..." })
 * writes keys "smtp.host", "smtp.password", etc.
 */
export async function upsertNamespacedSettings(namespace, data) {
  const promises = Object.entries(data).map(([field, value]) =>
    upsertSetting(`${namespace}.${field}`, value)
  );
  await Promise.all(promises);
}
