/**
 * reencryptSecrets.js
 * -------------------------------------------------------------------------
 * One-time migration: re-encrypt all secrets-at-rest from the OLD key
 * (previously derived from JWT_SECRET via the now-removed fallback) to the
 * NEW dedicated SETTINGS_ENCRYPTION_KEY.
 *
 * Stores covered:
 *   1. platform_settings: smtp.password, s3.secret_key, s3.access_key
 *   2. organisations.smtp_settings.integrations.{google,microsoft}.client_secret
 *   3. <each tenant DB>.calendar_connections.access_token / refresh_token
 *
 * Safety:
 *   - Idempotent: values already decryptable with the NEW key are skipped.
 *   - --dry-run reports what WOULD change without writing.
 *   - Values that decrypt with neither key are reported and left untouched.
 *
 * Usage:
 *   # OLD key source defaults to JWT_SECRET (the previous fallback).
 *   # Override with OLD_ENCRYPTION_SOURCE if you had set SETTINGS_ENCRYPTION_KEY before.
 *   SETTINGS_ENCRYPTION_KEY=<new 64-hex> node src/scripts/reencryptSecrets.js --dry-run
 *   SETTINGS_ENCRYPTION_KEY=<new 64-hex> node src/scripts/reencryptSecrets.js
 */

import crypto from "crypto";
import platformDb from "../models/index.js";
import { getTenantDb } from "../services/tenantDb.service.js";

const ALGO = "aes-256-gcm";
const DRY_RUN = process.argv.includes("--dry-run");
const SENSITIVE_PLATFORM_KEYS = new Set(["smtp.password", "s3.secret_key", "s3.access_key"]);

// --- key derivation -------------------------------------------------------

/** Replicates the legacy getDerivedKey(): 64-hex used directly, else sha256. */
function deriveLegacyKey(raw) {
  if (!raw) throw new Error("OLD key source is empty (set JWT_SECRET or OLD_ENCRYPTION_SOURCE).");
  const trimmed = String(raw).trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  return crypto.createHash("sha256").update(trimmed).digest();
}

function deriveNewKey() {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw.trim())) {
    throw new Error("SETTINGS_ENCRYPTION_KEY must be set to a 64-char hex string (the NEW key).");
  }
  return Buffer.from(raw.trim(), "hex");
}

const OLD_KEY = deriveLegacyKey(process.env.OLD_ENCRYPTION_SOURCE || process.env.JWT_SECRET);
const NEW_KEY = deriveNewKey();

// --- crypto primitives (mirrors settings.service format) ------------------

function decryptWith(key, cipher) {
  if (!cipher || typeof cipher !== "string" || !cipher.includes(":")) return null;
  try {
    const [ivHex, tagHex, dataHex] = cipher.split(":");
    const d = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
    d.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([d.update(Buffer.from(dataHex, "hex")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function encryptWith(key, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return `${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

const stats = { scanned: 0, migrated: 0, alreadyNew: 0, plaintext: 0, unrecoverable: 0 };

/**
 * Returns the re-encrypted ciphertext, or null when no change is needed.
 * Mutates stats as a side effect.
 */
function rotate(value, label) {
  if (value == null || value === "" || (typeof value === "string" && !value.includes(":"))) {
    if (value) stats.plaintext++;
    return null; // empty or legacy plaintext — nothing to rotate
  }
  stats.scanned++;
  if (decryptWith(NEW_KEY, value) !== null) {
    stats.alreadyNew++;
    return null; // already on the new key
  }
  const plain = decryptWith(OLD_KEY, value);
  if (plain === null) {
    stats.unrecoverable++;
    console.warn(`  ⚠ ${label}: decrypts with NEITHER key — left untouched (manual review).`);
    return null;
  }
  stats.migrated++;
  return encryptWith(NEW_KEY, plain);
}

// --- migrators ------------------------------------------------------------

async function migratePlatformSettings() {
  console.log("\n[1/3] platform_settings");
  const rows = await platformDb.PlatformSetting.findAll();
  for (const row of rows) {
    if (!SENSITIVE_PLATFORM_KEYS.has(row.key)) continue;
    const next = rotate(row.value, `platform_settings.${row.key}`);
    if (next && !DRY_RUN) await row.update({ value: next });
    if (next) console.log(`  • ${row.key} → re-encrypted${DRY_RUN ? " (dry-run)" : ""}`);
  }
}

async function migrateOrgIntegrationSecrets() {
  console.log("\n[2/3] organisations.smtp_settings.integrations.*.client_secret");
  const orgs = await platformDb.Organisation.findAll({ attributes: ["id", "slug", "smtp_settings"] });
  for (const org of orgs) {
    const settings = org.smtp_settings && typeof org.smtp_settings === "object" ? { ...org.smtp_settings } : null;
    const integrations = settings?.integrations;
    if (!integrations) continue;
    let changed = false;
    for (const provider of ["google", "microsoft"]) {
      const block = integrations[provider];
      if (!block?.client_secret) continue;
      const next = rotate(block.client_secret, `org#${org.id}.${provider}.client_secret`);
      if (next) {
        integrations[provider] = { ...block, client_secret: next };
        changed = true;
        console.log(`  • org#${org.id} (${org.slug}) ${provider}.client_secret → re-encrypted${DRY_RUN ? " (dry-run)" : ""}`);
      }
    }
    if (changed && !DRY_RUN) {
      await org.update({ smtp_settings: { ...settings, integrations } });
    }
  }
}

async function migrateTenantCalendarConnections() {
  console.log("\n[3/3] <tenant>.calendar_connections.access_token / refresh_token");
  const orgs = await platformDb.Organisation.findAll({
    where: { database_name: { [platformDb.Sequelize.Op.ne]: null } },
    attributes: ["id", "slug", "database_name"],
  });
  for (const org of orgs) {
    if (!org.database_name) continue;
    let tenantDb;
    try {
      tenantDb = getTenantDb(org.database_name);
    } catch (err) {
      console.warn(`  ⚠ org#${org.id} (${org.slug}): cannot open tenant DB — ${err.message}`);
      continue;
    }
    if (!tenantDb.CalendarConnection) continue;
    const conns = await tenantDb.CalendarConnection.findAll();
    for (const conn of conns) {
      const patch = {};
      const a = rotate(conn.access_token, `${org.database_name}#conn${conn.id}.access_token`);
      const r = rotate(conn.refresh_token, `${org.database_name}#conn${conn.id}.refresh_token`);
      if (a) patch.access_token = a;
      if (r) patch.refresh_token = r;
      if (Object.keys(patch).length && !DRY_RUN) await conn.update(patch);
      if (Object.keys(patch).length) {
        console.log(`  • ${org.database_name} conn#${conn.id} → ${Object.keys(patch).join(", ")} re-encrypted${DRY_RUN ? " (dry-run)" : ""}`);
      }
    }
  }
}

async function main() {
  console.log(`OAuth/secret re-encryption — ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  if (OLD_KEY.equals(NEW_KEY)) {
    console.error("OLD and NEW keys are identical — nothing to migrate. Aborting.");
    process.exit(1);
  }
  await migratePlatformSettings();
  await migrateOrgIntegrationSecrets();
  await migrateTenantCalendarConnections();

  console.log("\n──────────── summary ────────────");
  console.log(`  re-encrypted : ${stats.migrated}`);
  console.log(`  already new  : ${stats.alreadyNew}`);
  console.log(`  plaintext    : ${stats.plaintext} (left as-is)`);
  console.log(`  UNRECOVERABLE: ${stats.unrecoverable} (manual review)`);
  console.log(DRY_RUN ? "\nDry run complete — re-run without --dry-run to apply." : "\nMigration complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
