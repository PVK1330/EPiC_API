/**
 * settings.service.js
 * Helpers for reading/writing platform_settings key-value rows.
 * Sensitive values (SMTP password, S3 keys) are encrypted with AES-256-GCM
 * using SETTINGS_ENCRYPTION_KEY from the environment (falls back to JWT_SECRET
 * padded/hashed to 32 bytes so the app still works without a dedicated key).
 */

import crypto from "crypto";
import platformDb from "../models/index.js";

const { PlatformSetting } = platformDb;

// ---------------------------------------------------------------------------
// Encryption helpers (AES-256-GCM)
// ---------------------------------------------------------------------------

const ALGO = "aes-256-gcm";
const MASK = "••••••••";

/**
 * Derive a 32-byte key from the env variable.
 * SETTINGS_ENCRYPTION_KEY should be a 64-char hex string (32 bytes).
 * If it is not set we fall back to a SHA-256 hash of JWT_SECRET so the
 * service is always functional, but operators should set a dedicated key.
 */
function getDerivedKey() {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY || process.env.JWT_SECRET;
  // If it looks like a 64-char hex string use it directly, otherwise hash it.
  if (/^[0-9a-fA-F]{64}$/.test(raw.trim())) {
    return Buffer.from(raw.trim(), "hex");
  }
  return crypto.createHash("sha256").update(raw).digest();
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
