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
 *  - In production sameSite:'strict' works because all subdomains share the same
 *    registrable domain.
 *  - In development, tenant subdomains (elite-visa.localhost:5173) make
 *    cross-origin requests to localhost:5000. Even with secure:false + sameSite:lax
 *    some browsers decline to send the cookie on cross-origin same-site POST
 *    requests. To handle this reliably, csrfProtection (dev export) falls back to
 *    accepting the HMAC-signed header alone when the cookie is absent. Browsers
 *    cannot set custom request headers on cross-site requests (CORS policy), so
 *    the HMAC validation alone is equivalent security in dev.
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
    secure: isProd,  // dev runs over HTTP — Secure flag blocks cookie on plain HTTP
    sameSite: isProd ? "strict" : "lax",
    path: "/",
  };

  // In production share the CSRF cookie across all tenant subdomains.
  // In dev, do NOT set domain — browsers reject domain=.localhost.
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

/**
 * Dev-mode shim: if the CSRF cookie is absent (cross-origin subdomain request from
 * elite-visa.localhost → localhost:5000 where the browser may not send the cookie),
 * copy the header value into req.cookies so doubleCsrfProtection can find it.
 *
 * Security: the token is still HMAC-validated by doubleCsrfProtection — an
 * attacker cannot forge a valid token without the server secret, and browsers
 * block custom headers on cross-site requests (CORS), so this is safe in dev.
 */
function devCsrfCookieFill(req, res, next) {
  const headerToken = req.headers[CSRF_COOKIE_NAME];
  if (headerToken && !req.cookies[CSRF_COOKIE_NAME]) {
    req.cookies = req.cookies || {};
    req.cookies[CSRF_COOKIE_NAME] = headerToken;
  }
  next();
}

const isProd = process.env.NODE_ENV === "production";

/**
 * Use this instead of doubleCsrfProtection in app.js.
 * - Production: full double-submit cookie check (cookie + header must match).
 * - Development: fills missing cookie from header before the double-submit check,
 *   so subdomain tenant URLs (elite-visa.localhost:5173) work without needing
 *   the browser to send the cookie cross-origin.
 */
export function csrfProtection(req, res, next) {
  if (isProd) {
    return doubleCsrfProtection(req, res, next);
  }
  devCsrfCookieFill(req, res, () => doubleCsrfProtection(req, res, next));
}

export {
  CSRF_COOKIE_NAME,
  doubleCsrfProtection,
  generateCsrfToken,
  invalidCsrfTokenError,
};
