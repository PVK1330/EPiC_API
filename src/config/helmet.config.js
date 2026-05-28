/**
 * Helmet.js security hardening configuration for Express 5.
 *
 * Provides: XSS protection, CSP, HSTS, X-Frame-Options,
 * X-Content-Type-Options, Referrer-Policy, and more.
 *
 * CSP is environment-aware:
 *   - development: relaxed for Vite HMR, React Fast Refresh, inline styles
 *   - production:  strict with Stripe, Socket.IO, and tenant subdomains
 */

import helmet from "helmet";
import { getPlatformDomain } from "./frontendOrigins.js";

// ── Shared CSP origins (both dev & prod) ────────────────────────────────────
const STRIPE_ORIGINS = [
  "https://js.stripe.com",
  "https://api.stripe.com",
  "https://hooks.stripe.com",
  "https://checkout.stripe.com",
  "https://b.stripecdn.com",
  "https://m.stripe.com",
  "https://m.stripe.network",
];

const MICROSOFT_ORIGINS = [
  "https://login.microsoftonline.com",
  "https://graph.microsoft.com",
];

const GOOGLE_ORIGINS = [
  "https://accounts.google.com",
];

const GOOGLE_FONT_ORIGINS = [
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
];

// ── Per-environment helpers ─────────────────────────────────────────────────

/**
 * Builds the platform/tenant origin patterns for CSP.
 *
 * DEV:  localhost, *.localhost (tenant subdomains)
 * PROD: https://<domain>, https://*.domain, wss://*.domain
 */
function platformOrigins(platformDomain, isProd) {
  if (!platformDomain || platformDomain === "localhost") {
    return isProd ? [] : [
      "http://localhost:*",
      "http://127.0.0.1:*",
      "ws://localhost:*",
      "ws://127.0.0.1:*",
    ];
  }

  const origins = [];
  if (isProd) {
    origins.push(`https://${platformDomain}`);
    origins.push(`https://*.${platformDomain}`);
    origins.push(`wss://${platformDomain}`);
    origins.push(`wss://*.${platformDomain}`);
  } else {
    origins.push(`http://${platformDomain}`);
    origins.push(`http://*.${platformDomain}`);
    origins.push(`ws://${platformDomain}`);
    origins.push(`ws://*.${platformDomain}`);
  }
  return origins;
}

// ── CSP Builder ─────────────────────────────────────────────────────────────

function buildCspDirectives() {
  const platformDomain = getPlatformDomain();
  const isProd = process.env.NODE_ENV === "production";

  const self = "'self'";
  const unsafeInline = "'unsafe-inline'";
  const unsafeEval = "'unsafe-eval'";
  const data = "data:";
  const blob = "blob:";
  const none = "'none'";

  // Untrusted inline/ eval are needed by Vite in dev only
  const scriptSrc = isProd
    ? [self]
    : [self, unsafeInline, unsafeEval];

  // Inline styles are injected by React / Vite in dev; many component
  // libraries also need it in prod.  Keep unsafe-inline in both modes
  // and use nonce-based enforcement when stricter compliance is needed.
  const styleSrc = isProd
    ? [self, unsafeInline, ...GOOGLE_FONT_ORIGINS]
    : [self, unsafeInline, ...GOOGLE_FONT_ORIGINS];

  const connectSrc = [
    self,
    ...STRIPE_ORIGINS,
    ...MICROSOFT_ORIGINS,
    ...GOOGLE_ORIGINS,
    ...platformOrigins(platformDomain, isProd),
    // Socket.IO uses WebSocket upgrade; allow ws:///wss:// everywhere
    isProd ? "wss:" : "ws:",
    isProd ? "wss://*" : "ws://*",
  ];

  const imgSrc = [
    self,
    data,
    blob,
    ...STRIPE_ORIGINS,
    ...platformOrigins(platformDomain, isProd),
  ];

  const frameSrc = [
    self,
    "https://js.stripe.com",
    "https://hooks.stripe.com",
    "https://checkout.stripe.com",
    ...platformOrigins(platformDomain, isProd),
  ];

  const fontSrc = [self, data, ...GOOGLE_FONT_ORIGINS];

  const mediaSrc = [self];

  const objectSrc = [none];

  const baseUri = [self];

  const formAction = [
    self,
    "https://checkout.stripe.com",
    ...platformOrigins(platformDomain, isProd),
  ];

  const frameAncestors = [self];

  return {
    "default-src": [self],
    "script-src": scriptSrc,
    "script-src-attr": isProd ? [none] : [unsafeInline],
    "style-src": styleSrc,
    "style-src-attr": isProd ? [self] : [unsafeInline],
    "connect-src": connectSrc,
    "img-src": imgSrc,
    "frame-src": frameSrc,
    "font-src": fontSrc,
    "media-src": mediaSrc,
    "object-src": objectSrc,
    "base-uri": baseUri,
    "form-action": formAction,
    "frame-ancestors": frameAncestors,
    // Allow manifest for PWA
    "manifest-src": [self],
    // Allow Web Worker blobs (Socket.IO sometimes uses them)
    "worker-src": [self, blob],
  };
}

// ── Exported Helmet initialiser ─────────────────────────────────────────────

/**
 * Returns a configured Helmet middleware stack.
 *
 * The array form allows multiple middleware calls so each header
 * can be independently tuned.
 */
export function getHelmetMiddleware() {
  const isProd = process.env.NODE_ENV === "production";

  return [
    // ── Content Security Policy ────────────────────────────────────────────
    helmet.contentSecurityPolicy({
      directives: buildCspDirectives(),
      // Report-only mode for a gradual CSP rollout (set CSP_REPORT_ONLY=true)
      reportOnly: process.env.CSP_REPORT_ONLY === "true",
    }),

    // ── Cross-domain embedder / opener / resource policy ───────────────────
    // COEP: unsafe-none so Stripe & third-party embeds load
    helmet.crossOriginEmbedderPolicy({ policy: "unsafe-none" }),

    // COOP: same-origin-allow-popups so OAuth popups (Google, Microsoft) work
    helmet.crossOriginOpenerPolicy({ policy: "same-origin-allow-popups" }),

    // CORP: cross-origin so Stripe CDN assets load
    helmet.crossOriginResourcePolicy({ policy: "cross-origin" }),

    // ── X-DNS-Prefetch-Control ─────────────────────────────────────────────
    helmet.xDnsPrefetchControl({ allow: false }),

    // ── X-Frame-Options ────────────────────────────────────────────────────
    // SAMEORIGIN allows tenant subdomain embedding (shared apex domain)
    helmet.xFrameOptions({ action: "sameorigin" }),

    // ── HSTS (HTTP Strict-Transport-Security) ──────────────────────────────
    // 1 year, include sub-domains, preload-ready.
    // Disabled in dev because localhost has no TLS.
    helmet.hsts(
      isProd
        ? { maxAge: 31536000, includeSubDomains: true, preload: false }
        : { maxAge: 0, includeSubDomains: false, preload: false },
    ),

    // ── X-Content-Type-Options ─────────────────────────────────────────────
    helmet.xContentTypeOptions(),

    // ── Referrer-Policy ────────────────────────────────────────────────────
    helmet.referrerPolicy({ policy: "strict-origin-when-cross-origin" }),

    // ── X-Permitted-Cross-Domain-Policies ──────────────────────────────────
    helmet.xPermittedCrossDomainPolicies({ permittedPolicies: "none" }),

    // ── Remove X-Powered-By ────────────────────────────────────────────────
    helmet.xPoweredBy(),
  ];
}

export default getHelmetMiddleware;