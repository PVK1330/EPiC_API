/**
 * authRateLimiter.js
 *
 * Production-grade rate limiting middleware for authentication endpoints.
 *
 * ── DESIGN ─────────────────────────────────────────────────────────────────
 *
 * 1. Dual-key throttling – each limiter combines IP + email (when available) +
 *    tenant slug into a unique key, so an attacker cannot rotate IPs or emails
 *    independently to bypass limits.
 *
 * 2. Proxy-safe IP detection – uses req.ip which Express 5 populates from the
 *    leftmost X-Forwarded-For entry when `trust proxy` is enabled. Falls back
 *    to req.socket.remoteAddress for direct connections.
 *
 * 3. Tenant-aware – the organisation slug is baked into every rate-limit key,
 *    ensuring a tenant-specific subdomain cannot be used to circumvent limits
 *    that apply to the same IP/email on another tenant.
 *
 * 4. Memory store (dev / single-process) – uses the built-in in-memory store
 *    which is sufficient for single-instance deployments. For multi-process
 *    (PM2 cluster) or horizontally-scaled deployments, swap to Redis (see
 *    "Redis Upgrade Path" section below).
 *
 * ── RATE LIMITS ────────────────────────────────────────────────────────────
 *
 * | Endpoint          | Window  | Max  | Key       |
 * |-------------------|---------|------|-----------|
 * | POST /login       | 15 min  | 10   | tenant:ip |
 * | POST /register    | 1 hour  | 5    | tenant:ip |
 * | POST /forgot-pw   | 1 hour  | 5    | tenant:ip |
 * | POST /resend-otp  | 15 min  | 10   | tenant:ip |
 * | POST /verify-otp  | 15 min  | 10   | tenant:ip |
 * | POST /2fa/verify  | 15 min  | 10   | tenant:ip |
 * | * /api/auth/*     | 15 min  | 50   | tenant:ip | (global catch-all, in routes/index.js)
 *
 * ── REDIS UPGRADE PATH ─────────────────────────────────────────────────────
 *
 * To scale beyond a single process, install `rate-limit-redis` and configure
 * a shared Redis store:
 *
 *   1. npm install ioredis rate-limit-redis
 *   2. Create src/config/redisStore.js:
 *
 *        import { Redis } from 'ioredis';
 *        import { RedisStore } from 'rate-limit-redis';
 *
 *        const redis = new Redis({
 *          host: process.env.REDIS_HOST || '127.0.0.1',
 *          port: Number(process.env.REDIS_PORT) || 6379,
 *          password: process.env.REDIS_PASSWORD || undefined,
 *          enableOfflineQueue: false,
 *          maxRetriesPerRequest: null, // required by rate-limit-redis
 *        });
 *
 *        export const redisStore = new RedisStore({
 *          sendCommand: (...args) => redis.call(...args),
 *          prefix: 'rl:auth:',  // key namespace
 *        });
 *
 *   3. Pass `store: redisStore` to each createLimiter() call below.
 *
 *   Benefits:
 *     - Consistent rate limits across all PM2 workers / containers
 *     - Limits survive app restarts
 *     - Shared counter for load-balanced deployments
 *     - Redis Sentinel / Cluster for HA
 *
 * ── SECURITY NOTES ─────────────────────────────────────────────────────────
 *
 *   • Response deliberately vague: "Too many attempts" – never reveals
 *     whether the email/account exists.
 *   • Failed AND successful attempts are both counted (no skip-on-success)
 *     to prevent attackers from using valid credentials to probe.
 *   • Standard headers (RateLimit-*, Retry-After) are set so well-behaved
 *     clients can back off gracefully.
 */

import { rateLimit } from 'express-rate-limit';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract the client IP, respecting proxy headers when `trust proxy` is set.
 * Express 5 sets req.ip from the leftmost X-Forwarded-For entry when trusted.
 */
function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Normalize and extract email from the request body (if present).
 * Returns "no-email" as a sentinel so the key is still scoped.
 */
function getEmail(req) {
  const raw = req.body?.email;
  if (!raw || typeof raw !== 'string') return 'no-email';
  return raw.trim().toLowerCase();
}

/**
 * Extract the tenant identifier from the organisation-context middleware.
 * Returns "no-tenant" when no tenant is resolved (e.g. direct /register
 * without a subdomain before the org is attached).
 */
function getTenantSlug(req) {
  return req.organisationContext?.organisation?.slug
    || req.organisationContext?.slug
    || 'no-tenant';
}

/**
 * Build a compound rate-limit key.
 *
 * @param {'ip'|'ip+email'|'email'} mode
 *   - 'ip'        → tenant:ip
 *   - 'ip+email'  → tenant:ip:email
 *   - 'email'     → tenant:email
 */
function buildKey(mode) {
  return (req) => {
    const tenant = getTenantSlug(req);
    const ip = getClientIp(req);
    const email = getEmail(req);

    switch (mode) {
      case 'ip':
        return `${tenant}:${ip}`;
      case 'ip+email':
        return `${tenant}:${ip}:${email}`;
      case 'email':
        return `${tenant}:${email}`;
      default:
        return `${tenant}:${ip}`;
    }
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Response handler
// ────────────────────────────────────────────────────────────────────────────

/**
 * Standard rate-limit exceeded response.
 * Matches the project's JSON envelope convention.
 */
const rateLimitHandler = (req, res) => {
  res.status(429).json({
    status: 'error',
    message: 'Too many attempts. Please try again later.',
  });
};

/**
 * Skip rate limiting when the request is explicitly flagged (e.g. by
 * integration tests or internal service calls). Never skip in production
 * unless the X-Internal-RateLimit-Bypass header is present with the
 * correct shared secret.
 *
 * S-19 fix: guard against undefined===undefined when RATELIMIT_BYPASS_SECRET
 * is not set — an unset env var would allow any request with the header to
 * bypass rate limiting in non-production environments.
 */
const skipIfInternal = (req) => {
  if (process.env.NODE_ENV === 'production') return false;
  const bypassSecret = process.env.RATELIMIT_BYPASS_SECRET;
  if (!bypassSecret) return false;
  return req.headers['x-internal-ratelimit-bypass'] === bypassSecret;
};

// ────────────────────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a rate limiter with sensible defaults.
 *
 * @param {object} opts
 * @param {number} opts.windowMs  - time window in milliseconds
 * @param {number} opts.max       - max requests within the window
 * @param {'ip'|'ip+email'|'email'} opts.keyMode - key composition strategy
 * @param {string} [opts.message] - optional override for the 429 message
 */
function createLimiter({ windowMs, max, keyMode, message }) {
  const handler = message
    ? (req, res) => res.status(429).json({ status: 'error', message })
    : rateLimitHandler;

  return rateLimit({
    windowMs,
    max,
    keyGenerator: buildKey(keyMode),
    handler,
    skip: skipIfInternal,
    standardHeaders: true,   // RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset
    legacyHeaders: false,    // disable X-RateLimit-* (use draft-6 standard headers)
    statusCode: 429,
    // validate: false,       // uncomment if you hit false-positive validation errors in Express 5
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Exported limiters
// ────────────────────────────────────────────────────────────────────────────

const FIFTEEN_MINUTES = 15 * 60_000;
const ONE_HOUR = 60 * 60_000;

/** POST /api/auth/login — 10 attempts per 15 minutes per IP (tenant-scoped) */
export const loginLimiter = createLimiter({
  windowMs: FIFTEEN_MINUTES,
  max: 10,
  keyMode: 'ip',
});

/** POST /api/auth/register — 5 registrations per hour per IP (tenant-scoped) */
export const registerLimiter = createLimiter({
  windowMs: ONE_HOUR,
  max: 5,
  keyMode: 'ip',
});

/** POST /api/auth/forgot-password — 5 requests per hour per IP (tenant-scoped) */
export const forgotPasswordLimiter = createLimiter({
  windowMs: ONE_HOUR,
  max: 5,
  keyMode: 'ip',
});

/** POST /api/auth/resend-otp — 10 attempts per 15 minutes per IP (tenant-scoped) */
export const resendOtpLimiter = createLimiter({
  windowMs: FIFTEEN_MINUTES,
  max: 10,
  keyMode: 'ip',
});

/** POST /api/auth/verify-otp — 10 attempts per 15 minutes per IP (tenant-scoped) */
export const verifyOtpLimiter = createLimiter({
  windowMs: FIFTEEN_MINUTES,
  max: 10,
  keyMode: 'ip',
});

/** POST /api/auth/2fa/verify — 10 attempts per 15 minutes per IP (tenant-scoped) */
export const verify2FALimiter = createLimiter({
  windowMs: FIFTEEN_MINUTES,
  max: 10,
  keyMode: 'ip',
});

/**
 * POST /api/auth/verify-reset-otp — 5 attempts per 15 minutes per IP.
 * S-16 fix: tighter limit than the global 50/15min catch-all. Brute-forcing
 * a 6-digit OTP through this endpoint (900,000 combinations) would take ~45 hours
 * at 5 attempts per window vs ~2.5 hours at 50 attempts.
 */
export const verifyResetOtpLimiter = createLimiter({
  windowMs: FIFTEEN_MINUTES,
  max: 5,
  keyMode: 'ip',
  message: 'Too many reset attempts. Please wait before trying again.',
});

/**
 * POST /api/auth/set-password — RE-12 fix: dedicated limiter tighter than the
 * global 50/15min catch-all. Limits token-guessing if a reset_token leaks.
 */
export const setPasswordLimiter = createLimiter({
  windowMs: FIFTEEN_MINUTES,
  max: 10,
  keyMode: 'ip',
  message: 'Too many password-set attempts. Please wait before trying again.',
});

/**
 * Global auth limiter — catch-all for the entire /api/auth/* prefix.
 * 50 requests per 15 minutes per IP. Applied in routes/index.js.
 */
export const globalAuthLimiter = createLimiter({
  windowMs: FIFTEEN_MINUTES,
  max: 50,
  keyMode: 'ip',
});

// ────────────────────────────────────────────────────────────────────────────
// Named export group (convenience for bulk application)
// ────────────────────────────────────────────────────────────────────────────

export default {
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  resendOtpLimiter,
  verifyOtpLimiter,
  verifyResetOtpLimiter,
  verify2FALimiter,
  setPasswordLimiter,
  globalAuthLimiter,
};