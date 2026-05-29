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

const REQUIRED_VARS = [
  {
    key: "JWT_SECRET",
    label: "JWT_SECRET",
    hint: "Generate a strong random secret (e.g. `node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"`)",
    minLength: 32,
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

  for (const { key, label, hint, minLength } of vars) {
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
    }
  }

  if (missing.length > 0) {
    console.error("");
    console.error("╔══════════════════════════════════════════════════════════╗");
    console.error("║  FATAL: Required environment variable(s) missing/weak   ║");
    console.error("╠══════════════════════════════════════════════════════════╣");
    for (const m of missing) {
      console.error(`║  • ${m.label.padEnd(48)} ║`);
      console.error(`║    ${m.hint.padEnd(50)} ║`);
      console.error("║                                                        ║");
    }
    console.error("║  Server startup ABORTED. Set the variable(s) above      ║");
    console.error("║  in your .env file and restart.                        ║");
    console.error("╚══════════════════════════════════════════════════════════╝");
    console.error("");
    process.exit(1);
  }

  console.log("✔ Environment validation passed");
}

export default validateRequiredEnv;