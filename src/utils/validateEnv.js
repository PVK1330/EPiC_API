/**
 * validateEnv.js
 * Centralised environment variable validation utility.
 *
 * Enforces mandatory variables at startup so the server fails fast with a clear
 * message rather than silently accepting insecure defaults at runtime.
 *
 * Usage (call at the very top of server.js, after dotenv/config):
 *   import { validateRequiredEnv } from "./utils/validateEnv.js";
 *   validateRequiredEnv();
 */

import logger from "./logger.js";

const REQUIRED_VARS = [
  {
    key: "JWT_SECRET",
    label: "JWT_SECRET",
    hint: "Generate a strong random secret (e.g. `node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"`)",
    minLength: 32,
  },
  {
    key: "SETTINGS_ENCRYPTION_KEY",
    label: "SETTINGS_ENCRYPTION_KEY",
    hint: "Dedicated AES-256 key for secrets at rest — must be 64 hex chars (32 bytes), and MUST be different from JWT_SECRET. Generate: `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"`",
    // Must be exactly 32 bytes, hex-encoded, and must not equal JWT_SECRET.
    validate: (value) => {
      const v = value.trim();
      if (!/^[0-9a-fA-F]{64}$/.test(v)) {
        return "must be a 64-character hex string (32 bytes)";
      }
      if (process.env.JWT_SECRET && v === process.env.JWT_SECRET.trim()) {
        return "must NOT be the same value as JWT_SECRET";
      }
      return null;
    },
  },
  {
    key: "LICENCE_CRED_SECRET",
    label: "LICENCE_CRED_SECRET",
    hint: "Secret used to derive the AES-256 key for UKVI portal password encryption in licenceGovernmentTracking. Any strong random string works; recommended: `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"`",
    minLength: 16,
  },
  {
    key: "FIELD_ENCRYPTION_KEY",
    label: "FIELD_ENCRYPTION_KEY",
    hint: "AES-256 key for field-level PII encryption (NI numbers, passport numbers, BRP numbers, etc.). Must be a 64-character hex string (32 bytes) distinct from SETTINGS_ENCRYPTION_KEY. Generate: `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"`",
    validate: (value) => {
      const v = value.trim();
      if (!/^[0-9a-fA-F]{64}$/.test(v)) {
        return "must be a 64-character hex string (32 bytes)";
      }
      if (
        process.env.SETTINGS_ENCRYPTION_KEY &&
        v === process.env.SETTINGS_ENCRYPTION_KEY.trim()
      ) {
        return "must NOT be the same value as SETTINGS_ENCRYPTION_KEY";
      }
      if (process.env.JWT_SECRET && v === process.env.JWT_SECRET.trim()) {
        return "must NOT be the same value as JWT_SECRET";
      }
      return null;
    },
  },
];

/**
 * Validate that every REQUIRED_VARS entry is present and meets minimum length.
 * Terminates the process immediately with exit code 1 on failure.
 *
 * @param {Array<{key:string, label:string, hint:string, minLength?:number}>} [vars]
 *   Optional override list; defaults to REQUIRED_VARS.
 */
export function validateRequiredEnv(vars = REQUIRED_VARS) {
  const missing = [];

  for (const { key, label, hint, minLength, validate } of vars) {
    const value = process.env[key];

    if (!value || (typeof value === "string" && value.trim().length === 0)) {
      missing.push({ label, hint });
      continue;
    }

    if (minLength && typeof value === "string" && value.trim().length < minLength) {
      missing.push({
        label,
        hint: `${hint} Current value is only ${value.trim().length} character(s) — minimum is ${minLength}.`,
      });
      continue;
    }

    if (typeof validate === "function") {
      const error = validate(value);
      if (error) {
        missing.push({ label, hint: `${label} ${error}. ${hint}` });
      }
    }
  }

  if (missing.length > 0) {
    logger.error("");
    logger.error("╔══════════════════════════════════════════════════════════╗");
    logger.error("║  FATAL: Required environment variable(s) missing/weak   ║");
    logger.error("╠══════════════════════════════════════════════════════════╣");
    for (const m of missing) {
      logger.error(`║  • ${m.label.padEnd(48)} ║`);
      logger.error(`║    ${m.hint.padEnd(50)} ║`);
      logger.error("║                                                        ║");
    }
    logger.error("║  Server startup ABORTED. Set the variable(s) above      ║");
    logger.error("║  in your .env file and restart.                        ║");
    logger.error("╚══════════════════════════════════════════════════════════╝");
    logger.error("");
    process.exit(1);
  }

  logger.info("✔ Environment validation passed");
}

export default validateRequiredEnv;