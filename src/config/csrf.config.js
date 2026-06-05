/**
 * csrf.config.js
 * CSRF protection via the double-submit cookie pattern (csrf-csrf v4).
 *
 * HOW IT WORKS
 *  - generateCsrfToken() sets a cookie whose value IS the token and returns the
 *    same value. The browser stores the cookie; the frontend reads it and echoes
 *    it back in the `x-csrf-token` header on every mutating request.
 *  - doubleCsrfProtection requires header === cookie AND a valid HMAC, so a
 *    cross-site attacker (who cannot read the victim's cookie) cannot forge it.
 *
 * MULTI-TENANT / CROSS-SUBDOMAIN NOTES
 *  - The frontend (cms.<domain> / <tenant>.<domain>) and the API (server.<domain>)
 *    are different hosts, so the cookie must be:
 *      • httpOnly: false  → the frontend JS needs to read it
 *      • domain: .<platformDomain> (prod) → readable on every subdomain
 *    In dev (localhost) cookies ignore the port, so no domain is needed.
 *  - sameSite mirrors the auth cookie: 'strict' in prod (subdomains share the
 *    registrable domain, so the cookie is still sent), 'none' in dev for
 *    *.localhost tenant testing.
 *
 * The session identifier is intentionally constant: this is a stateless
 * double-submit setup, so tokens must stay valid across login/logout (binding to
 * the JWT would invalidate the token the moment the user logs in).
 */

import crypto from "crypto";
import { doubleCsrf } from "csrf-csrf";
import { getPlatformDomain } from "./frontendOrigins.js";

const CSRF_COOKIE_NAME = "x-csrf-token";

function getCsrfSecret() {
  const secret = process.env.CSRF_SECRET;
  if (secret && secret.length >= 32) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "CSRF_SECRET must be set to a strong value (>= 32 chars) in production.",
    );
  }

  // Dev only: ephemeral per-process secret (tokens reset on server restart).
  if (!globalThis.__CSRF_DEV_SECRET) {
    globalThis.__CSRF_DEV_SECRET = crypto.randomBytes(32).toString("hex");
  }
  return globalThis.__CSRF_DEV_SECRET;
}

function csrfCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  const platformDomain = getPlatformDomain();

  const options = {
    httpOnly: false, // frontend must read it to echo in the header
    secure: true,
    sameSite: isProd ? "strict" : "none",
    path: "/",
  };

  // Share across tenant subdomains in production so the frontend host can read
  // the cookie that is also presented to the API host.
  if (isProd && platformDomain && platformDomain !== "localhost") {
    options.domain = `.${platformDomain}`;
  }

  return options;
}

/** Paths that must never be CSRF-checked (no cookies / different auth model). */
function shouldSkipCsrf(req) {
  const url = req.originalUrl || req.url || "";
  // Stripe webhook authenticates via signature on a raw body — not a browser.
  if (url.startsWith("/api/stripe/webhook")) return true;
  // Cross-subdomain impersonation handoff: this POST lands on a tenant subdomain
  // that has no CSRF cookie yet. Security here is the single-use, opaque,
  // server-validated ticket (see impersonationTicket.service.js), not CSRF.
  if (url.startsWith("/api/auth/handoff")) return true;
  return false;
}

const { doubleCsrfProtection, generateCsrfToken, invalidCsrfTokenError } =
  doubleCsrf({
    getSecret: getCsrfSecret,
    getSessionIdentifier: () => "epic-stateless",
    cookieName: CSRF_COOKIE_NAME,
    cookieOptions: csrfCookieOptions(),
    ignoredMethods: ["GET", "HEAD", "OPTIONS"],
    getCsrfTokenFromRequest: (req) => req.headers[CSRF_COOKIE_NAME],
    skipCsrfProtection: shouldSkipCsrf,
  });

export {
  CSRF_COOKIE_NAME,
  doubleCsrfProtection,
  generateCsrfToken,
  invalidCsrfTokenError,
};
