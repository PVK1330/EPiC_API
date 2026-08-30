import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import compression from 'compression';

import routes from './routes/index.js';
import { getSettingsByNamespace } from './services/settings.service.js';
import { getCorsOptions } from './config/frontendOrigins.js';
import { getHelmetMiddleware } from './config/helmet.config.js';
import { csrfProtection, generateCsrfToken } from './config/csrf.config.js';
import { handleWebhook } from './modules/Candidate/Payments/stripepayment.controller.js';
import {
  requestContextMiddleware,
  requestLoggingMiddleware,
} from './middlewares/requestLogger.middleware.js';
import logger from './utils/logger.js';

const app = express();

// ── Proxy-safe IP detection ──────────────────────────────────────────────────
// Required for rate-limiters to see the real client IP when behind a reverse
// proxy (nginx, AWS ALB, Cloudflare, etc.). Express 5 reads the leftmost
// entry from X-Forwarded-For when `trust proxy` is set.
//
// Production: set TRUST_PROXY=true in .env (or configure a specific IP/CIDR).
// Development: defaults to false (loopback only).
//
// NOTE: Only enable when behind a trusted proxy. Exposing this on a public-
// facing server allows clients to spoof their IP via X-Forwarded-For.
const trustProxy = process.env.NODE_ENV === 'production'
  ? (process.env.TRUST_PROXY === 'false' ? false : true)
  : false;
app.set('trust proxy', trustProxy);

// ── Security headers (Helmet.js) ─────────────────────────────────────────────
app.use(...getHelmetMiddleware());

// ── Request ID & structured access logging ────────────────────────────────────
// requestContextMiddleware MUST run early so req.requestId is available to all
// downstream middleware and route handlers.
app.use(requestContextMiddleware);
app.use(requestLoggingMiddleware);

app.use(compression({ level: 6, threshold: 1024 }));

app.use(cors(getCorsOptions()));

// ── Health check (BUG-045) ────────────────────────────────────────────────────
// Public, unauthenticated, CSRF-exempt (registered before the /api CSRF guard).
// Used by load balancers / uptime monitors to confirm the process is serving.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Stripe webhooks must use raw body for signature verification.
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  handleWebhook,
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());       // must be BEFORE any route that reads req.cookies

// ── CSRF (double-submit cookie) ───────────────────────────────────────────────
// Must run AFTER cookieParser. The Stripe webhook above is registered earlier and
// is also excluded via skipCsrfProtection, so it never reaches this guard.
//
// Token bootstrap: the frontend calls GET /api/csrf-token to receive the cookie,
// then echoes its value in the `x-csrf-token` header on every mutating request.
app.get('/api/csrf-token', (req, res) => {
  const csrfToken = generateCsrfToken(req, res);
  res.json({ csrfToken });
});

// Enforce CSRF on all mutating /api requests (GET/HEAD/OPTIONS are ignored).
// In dev, csrfProtection also fills the missing cookie from the header for
// cross-origin subdomain requests (see csrf.config.js for the security rationale).
app.use('/api', csrfProtection);

const STATIC_CACHE = { maxAge: '7d', etag: true, lastModified: true };
// WARNING: The /uploads directory is no longer served statically for security reasons.
// All document requests MUST go through the authenticated /api/documents/:id/download endpoint.
app.use('/assets', express.static('assets', STATIC_CACHE));

// Expose ONLY sanitized, safe public branding images (logos, avatars)
// These are heavily restricted and passed through sharp sanitization during upload
app.use('/api/public/images', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  next();
}, express.static('storage/private/organisations', STATIC_CACHE),
   express.static('storage/private/platform', STATIC_CACHE),
   express.static('storage/private/superadmin', STATIC_CACHE),
   express.static('storage/private/avatars', STATIC_CACHE));

// Public favicon — browsers request /favicon.ico before any scripts load.
// Reads the platform setting and redirects to the static file so the browser
// tab shows whatever the superadmin uploaded in the branding settings.
// Returns 204 (no content) when no favicon has been uploaded yet.
app.get('/favicon.ico', async (req, res) => {
  try {
    const settings = await getSettingsByNamespace(null);
    const faviconPath = settings?.favicon_url;
    if (!faviconPath) return res.status(204).end();
    // faviconPath is stored as "api/public/images/<file>" (no leading slash).
    const redirectTo = faviconPath.startsWith('/') ? faviconPath : `/${faviconPath}`;
    return res.redirect(302, redirectTo);
  } catch {
    return res.status(204).end();
  }
});

// API Routes
app.use('/api', routes);

// API 404 handler
app.use('/api', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'API route not found',
  });
});

// Global error handler
app.use((err, req, res, _next) => {
  // Use req.log if available (requestContextMiddleware injected it),
  // otherwise fall back to the root logger.
  const log = req.log || logger;

  // Translate common database/ORM failures into clear 4xx responses. Without this
  // they surface as an opaque 500 — "Internal server error" in production — which
  // is what the Edit Client form showed when a value was longer than its column
  // (BUG-020). Postgres SQLSTATE codes come wrapped by Sequelize in err.parent.
  const pgCode = err?.parent?.code || err?.original?.code || err?.code;
  const pgDetail = err?.parent?.message || err?.original?.message || '';
  let mapped = null;
  if (
    pgCode === '22P02' ||        // invalid_text_representation (bad int/uuid/enum literal)
    pgCode === '22003' ||        // numeric_value_out_of_range
    (err?.name === 'SequelizeDatabaseError' && /invalid input syntax/i.test(err?.message || ''))
  ) {
    mapped = { status: 400, message: 'Invalid request parameter format.' };
  } else if (pgCode === '22001') { // string_data_right_truncation
    const limit = /character varying\((\d+)\)/.exec(pgDetail)?.[1];
    mapped = {
      status: 400,
      message: limit
        ? `One of the values you entered is too long (maximum ${limit} characters). Please shorten it and try again.`
        : 'One of the values you entered is too long. Please shorten it and try again.',
    };
  } else if (pgCode === '22007' || pgCode === '22008') { // invalid datetime
    mapped = { status: 400, message: 'One of the dates you entered is not valid.' };
  } else if (err?.name === 'SequelizeValidationError') {
    mapped = { status: 400, message: err.errors?.[0]?.message || 'Some of the values you entered are not valid.' };
  } else if (err?.name === 'SequelizeUniqueConstraintError' || pgCode === '23505') {
    const field = err?.errors?.[0]?.path;
    mapped = {
      status: 409,
      message: field ? `This ${String(field).replace(/_/g, ' ')} is already in use.` : 'This record already exists.',
    };
  } else if (pgCode === '23503') { // foreign_key_violation
    mapped = { status: 400, message: 'A linked record no longer exists, so this change cannot be saved.' };
  } else if (pgCode === '23502') { // not_null_violation
    mapped = { status: 400, message: 'A required field is missing.' };
  }
  if (mapped && !res.headersSent) {
    log.warn(
      { pgCode, errName: err?.name, detail: pgDetail, url: req.originalUrl, method: req.method },
      'Rejected request with invalid data',
    );
    return res.status(mapped.status).json({ status: 'error', message: mapped.message, data: null });
  }

  const statusCode = err?.status || err?.statusCode || 500;
  const isClientError = statusCode >= 400 && statusCode < 500;

  log.error({
    err,
    statusCode,
    method: req.method,
    url: req.originalUrl,
  }, 'Unhandled server error');

  // Surface client-error (4xx) messages even in production — they are safe and
  // actionable (e.g. "invalid csrf token"). 5xx messages are masked, but carry the
  // request id so support can find the matching log line.
  const masked = process.env.NODE_ENV === 'production' && !isClientError;
  const reference = req.requestId ? String(req.requestId).slice(0, 8) : null;
  res.status(statusCode).json({
    status: 'error',
    message: masked
      ? `Something went wrong on our side${reference ? ` (ref ${reference})` : ''}. Please try again, or contact support quoting this reference.`
      : err?.message || 'Internal server error',
    errors: err?.errors,
    ...(masked && req.requestId ? { reference: req.requestId } : {}),
  });
});

export default app;