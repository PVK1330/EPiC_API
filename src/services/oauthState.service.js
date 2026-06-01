import crypto from "crypto";
import platformDb from "../models/index.js";
import logger from "../utils/logger.js";

/**
 * OAuth CSRF state service.
 *
 * Implements the OAuth 2.0 `state` parameter as a cryptographically-random,
 * single-use, short-lived nonce (RFC 6749 §10.12). The nonce is stored
 * server-side bound to the originating user; the user's session token is kept
 * server-side too and NEVER placed in the OAuth state query parameter.
 */

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SUPPORTED_PROVIDERS = new Set(["google", "microsoft"]);

/** 256 bits of CSPRNG entropy, hex-encoded (64 chars). */
export function generateOAuthStateValue() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Factory so the store can be unit-tested with an injected fake `db`.
 * @param {object} db - object exposing `OAuthState` (and optionally `sequelize`)
 */
export function makeOAuthStateService(db = platformDb) {
  /**
   * Create and persist a new OAuth state nonce.
   * @returns {Promise<string>} the random state value to put in the auth URL
   */
  async function createOAuthState({
    userId,
    organisationId = null,
    provider,
    authToken = null,
    ttlMs = OAUTH_STATE_TTL_MS,
    now = Date.now(),
  }) {
    if (!SUPPORTED_PROVIDERS.has(provider)) {
      throw new Error(`Unsupported OAuth provider: ${provider}`);
    }
    if (!userId) {
      throw new Error("userId is required to create an OAuth state");
    }

    const state = generateOAuthStateValue();
    await db.OAuthState.create({
      state,
      provider,
      user_id: userId,
      organisation_id: organisationId ?? null,
      auth_token: authToken ?? null,
      expires_at: new Date(now + ttlMs),
    });
    return state;
  }

  /**
   * Validate and atomically consume a state nonce. The row is ALWAYS deleted on
   * lookup (single use), so a replay finds nothing. Returns the bound session
   * only when the state exists, matches the provider, and has not expired.
   *
   * @returns {Promise<null | {userId, organisationId, provider, authToken}>}
   */
  async function consumeOAuthState(state, provider, { now = Date.now() } = {}) {
    if (!state || typeof state !== "string") return null;
    if (!SUPPORTED_PROVIDERS.has(provider)) return null;

    const runner = async (transaction) => {
      const record = await db.OAuthState.findOne({
        where: { state, provider },
        ...(transaction ? { transaction, lock: true } : {}),
      });

      // Unknown nonce, already-consumed (replayed), or wrong provider.
      if (!record) return null;

      // Single-use: delete immediately, regardless of expiry, so it can never
      // be used again.
      await record.destroy(transaction ? { transaction } : undefined);

      if (new Date(record.expires_at).getTime() < now) {
        return null; // expired
      }

      return {
        userId: record.user_id,
        organisationId: record.organisation_id,
        provider: record.provider,
        authToken: record.auth_token,
      };
    };

    // Use a locking transaction in production for true concurrency-safe
    // single-use semantics; fall back to a plain run when unavailable (tests).
    if (db.sequelize?.transaction) {
      return db.sequelize.transaction((t) => runner(t));
    }
    return runner(null);
  }

  /** Housekeeping: delete expired rows. Safe to call from a cron job. */
  async function purgeExpiredOAuthStates({ now = Date.now() } = {}) {
    try {
      return await db.OAuthState.destroy({
        where: { expires_at: { [db.Sequelize.Op.lt]: new Date(now) } },
      });
    } catch (err) {
      logger.error({ err }, "Failed to purge expired OAuth states");
      return 0;
    }
  }

  return { createOAuthState, consumeOAuthState, purgeExpiredOAuthStates };
}

const service = makeOAuthStateService();
export const createOAuthState = service.createOAuthState;
export const consumeOAuthState = service.consumeOAuthState;
export const purgeExpiredOAuthStates = service.purgeExpiredOAuthStates;
