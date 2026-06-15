/**
 * jwt.config.js
 * Centralised JWT configuration.
 *
 * Every JWT sign/verify operation in the codebase MUST go through this module.
 * No file should ever call jwt.sign() / jwt.verify() with an inline secret.
 *
 * SECURITY:
 * - JWT_SECRET is mandatory (enforced by validateEnv.js at startup).
 * - Expiry defaults are production-safe.
 * - All cookie flags use secure defaults.
 * - No hardcoded fallback secrets exist anywhere in this module.
 */

import jwt from "jsonwebtoken";

// ---------------------------------------------------------------------------
// Centralised secret accessor — throws if missing (belt-and-suspenders)
// ---------------------------------------------------------------------------
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET is not set. Server startup should have been aborted by validateEnv.js. " +
      "Check your .env file and restart.",
    );
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Secure defaults
// ---------------------------------------------------------------------------

/** Default token expiry for authentication tokens (login, OTP verify, 2FA). */
export const AUTH_TOKEN_EXPIRY = process.env.JWT_EXPIRY || "7d";

/** Expiry for short-lived tokens (password reset, magic links, etc.). */
export const SHORT_TOKEN_EXPIRY = process.env.JWT_SHORT_EXPIRY || "10m";

/** Impersonation token lifetime (superadmin impersonating org admin). */
export const IMPERSONATION_TOKEN_EXPIRY = process.env.JWT_IMPERSONATION_EXPIRY || "1h";

// ---------------------------------------------------------------------------
// Cookie configuration — used by logout / refresh flows
// ---------------------------------------------------------------------------

/**
 * Secure cookie options.
 * - httpOnly: true (JS cannot read the cookie)
 * - secure: true in production (sent only over HTTPS)
 * - sameSite: 'strict' (CSRF protection)
 * - path: '/' (available everywhere)
 */
export function getCookieConfig(overrides = {}) {
  const isProduction = process.env.NODE_ENV === "production";
  
  return {
    httpOnly: true,
    // Production: Secure + SameSite=Strict (HTTPS, same registrable domain).
    // Development: Secure=false so the cookie works over plain HTTP.
    //   SameSite=Lax allows the cookie to be sent on same-site cross-origin
    //   requests (elite-visa.localhost → localhost share the "localhost" eTLD+1
    //   so Chrome/Firefox treat them as same-site).
    //   We do NOT use SameSite=None because None requires Secure, and
    //   *.localhost subdomains are NOT granted the localhost Secure-context
    //   exception — the browser silently drops Secure cookies over HTTP from
    //   a subdomain origin, which causes immediate 401 → logout after login.
    secure: isProduction,
    sameSite: isProduction ? "strict" : "lax",
    path: "/",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Sign helpers — centralised factories
// ---------------------------------------------------------------------------

/**
 * Sign a JWT with the mandatory secret.
 *
 * @param {object} payload  - Claims to encode.
 * @param {object} [options] - jsonwebtoken SignOptions (expiresIn, etc.).
 * @returns {string} Signed JWT.
 */
export function signToken(payload, options = {}) {
  const secret = getJwtSecret();
  const opts = {
    expiresIn: AUTH_TOKEN_EXPIRY,
    ...options,
  };
  return jwt.sign(payload, secret, opts);
}

/**
 * Sign a short-lived token (password reset, etc.).
 * ExpiresIn defaults to SHORT_TOKEN_EXPIRY.
 */
export function signShortToken(payload, options = {}) {
  return signToken(payload, { expiresIn: SHORT_TOKEN_EXPIRY, ...options });
}

/**
 * Sign an impersonation token (superadmin → org admin).
 * ExpiresIn defaults to IMPERSONATION_TOKEN_EXPIRY.
 */
export function signImpersonationToken(payload, options = {}) {
  return signToken(payload, { expiresIn: IMPERSONATION_TOKEN_EXPIRY, ...options });
}

// ---------------------------------------------------------------------------
// Verify helpers
// ---------------------------------------------------------------------------

/**
 * Verify a token string synchronously.
 * @param {string} token - The raw JWT.
 * @returns {object} Decoded payload.
 * @throws {JsonWebTokenError|TokenExpiredError|NotBeforeError} On failure.
 */
export function verifyToken(token, ignoreExpiration = false) {
  try {
    return jwt.verify(token, getJwtSecret(), { ignoreExpiration });
  } catch (err) {
    if (ignoreExpiration && err.name === 'TokenExpiredError') {
      return jwt.decode(token);
    }
    throw err;
  }
}

/**
 * Verify a token with a callback (async style, used by Socket.IO middleware).
 * @param {string} token
 * @param {(err: Error|null, decoded: object|null) => void} callback
 */
export function verifyTokenAsync(token, callback) {
  jwt.verify(token, getJwtSecret(), callback);
}

// ---------------------------------------------------------------------------
// Re-export for convenience (avoids importing jsonwebtoken elsewhere)
// ---------------------------------------------------------------------------
export { jwt };