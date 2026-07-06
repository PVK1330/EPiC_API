/**
 * encrypt2faSecrets.js
 * -------------------------------------------------------------------------
 * One-time backfill: encrypt existing plaintext `two_factor_secret` (TOTP seed)
 * values at rest on the platform users table, closing data-leakage-2's
 * "2FA plaintext at rest" residual.
 *
 * Uses the shared fieldEncryption helper (FIELD_ENCRYPTION_KEY, AES-256-GCM),
 * the same one the app now uses on 2FA setup. Because decrypt() passes legacy
 * plaintext through unchanged AND decrypts encrypted values, the app keeps
 * verifying seeds whether or not this backfill has run — so this is safe to run
 * at any time and is fully idempotent.
 *
 * Safety:
 *   - Idempotent: already-encrypted values (sentinel iv:tag:ct) are skipped.
 *   - --dry-run reports what WOULD change without writing.
 *   - After each write it re-reads and asserts decrypt(stored) === original seed
 *     so a row is never left in an unverifiable state.
 *
 * Usage:
 *   node src/scripts/encrypt2faSecrets.js --dry-run
 *   node src/scripts/encrypt2faSecrets.js
 */

import platformDb from "../models/index.js";
import { encrypt, decrypt } from "../utils/fieldEncryption.js";

const DRY_RUN = process.argv.includes("--dry-run");
const ENCRYPTED_RE = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;

const stats = { scanned: 0, encrypted: 0, alreadyEncrypted: 0, empty: 0, failed: 0 };

async function main() {
  console.log(`2FA seed at-rest encryption — ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);

  const users = await platformDb.User.findAll({
    attributes: ["id", "email", "two_factor_secret"],
  });

  for (const user of users) {
    const secret = user.two_factor_secret;
    if (secret == null || secret === "") { stats.empty++; continue; }
    stats.scanned++;

    if (typeof secret === "string" && ENCRYPTED_RE.test(secret)) {
      stats.alreadyEncrypted++;
      continue;
    }

    const enc = encrypt(secret);
    // Guard: never write a value we cannot decrypt back to the original seed.
    if (decrypt(enc) !== secret) {
      stats.failed++;
      console.warn(`  ⚠ user#${user.id} (${user.email}): round-trip check FAILED — left untouched.`);
      continue;
    }

    if (!DRY_RUN) {
      await user.update({ two_factor_secret: enc });
      const fresh = await platformDb.User.findByPk(user.id, { attributes: ["two_factor_secret"] });
      if (decrypt(fresh.two_factor_secret) !== secret) {
        stats.failed++;
        console.error(`  ✗ user#${user.id} (${user.email}): post-write verify FAILED.`);
        continue;
      }
    }

    stats.encrypted++;
    console.log(`  • user#${user.id} (${user.email}) → 2FA seed encrypted${DRY_RUN ? " (dry-run)" : ""}`);
  }

  console.log("\n──────────── summary ────────────");
  console.log(`  encrypted        : ${stats.encrypted}`);
  console.log(`  already encrypted: ${stats.alreadyEncrypted}`);
  console.log(`  no 2FA seed      : ${stats.empty}`);
  console.log(`  FAILED           : ${stats.failed}`);
  console.log(DRY_RUN ? "\nDry run complete — re-run without --dry-run to apply." : "\nBackfill complete.");
  process.exit(stats.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
