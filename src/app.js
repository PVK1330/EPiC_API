import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import compression from 'compression';

import routes from './routes/index.js';
import { getCorsOptions } from './config/frontendOrigins.js';
import { getHelmetMiddleware } from './config/helmet.config.js';
import { doubleCsrfProtection, generateCsrfToken } from './config/csrf.config.js';
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
app.use('/api', doubleCsrfProtection);

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
   express.static('storage/private/superadmin', STATIC_CACHE));

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

  const statusCode = err?.status || err?.statusCode || 500;
  const isClientError = statusCode >= 400 && statusCode < 500;

  log.error({
    err,
    statusCode,
    method: req.method,
    url: req.originalUrl,
  }, 'Unhandled server error');

  // Surface client-error (4xx) messages even in production — they are safe and
  // actionable (e.g. "invalid csrf token"). Only 5xx messages are masked.
  res.status(statusCode).json({
    status: 'error',
    message: (process.env.NODE_ENV === 'production' && !isClientError)
      ? 'Internal server error'
      : err?.message || 'Internal server error',
    errors: err?.errors,
  });
});

export default app;