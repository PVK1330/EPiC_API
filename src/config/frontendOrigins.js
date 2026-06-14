import { parseOrganisationSlugFromHost } from "../utils/organisationHost.js";
import logger from "../utils/logger.js";

const LOCAL_DEV_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
];

function parseEnvList(value) {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

export function getPlatformDomain() {
  return String(process.env.PLATFORM_DOMAIN || "localhost").toLowerCase();
}

/**
 * Production CMS app host (cms.elitepic.co.uk when PLATFORM_DOMAIN=elitepic.co.uk).
 */
function getCmsAppOrigins() {
  const platform = getPlatformDomain();
  if (!platform || platform === "localhost" || platform === "127.0.0.1") {
    return [];
  }
  const origins = [];
  for (const scheme of ["https", "http"]) {
    origins.push(`${scheme}://cms.${platform}`);
  }
  return origins;
}

/**
 * Apex + www URLs for PLATFORM_DOMAIN (e.g. https://elitepic.co.uk).
 */
function getPlatformApexOrigins() {
  const platform = getPlatformDomain();
  if (!platform || platform === "localhost" || platform === "127.0.0.1") {
    return [];
  }
  const origins = [];
  for (const scheme of ["https", "http"]) {
    origins.push(`${scheme}://${platform}`);
    origins.push(`${scheme}://www.${platform}`);
  }
  return origins;
}

/**
 * FRONTEND_URL, CORS_ORIGINS, and CLIENT_URL may each be comma-separated.
 * Used by Express CORS and Socket.IO.
 */
export function getFrontendOrigins() {
  const explicit = [
    ...parseEnvList(process.env.FRONTEND_URL),
    ...parseEnvList(process.env.CORS_ORIGINS),
    ...parseEnvList(process.env.CLIENT_URL),
  ];

  const base = explicit.length > 0 ? explicit : LOCAL_DEV_ORIGINS;
  return [
    ...new Set([
      ...base,
      ...getCmsAppOrigins(),
      ...getPlatformApexOrigins(),
    ]),
  ];
}

/**
 * Allow listed origins, platform apex/www, and tenant subdomains
 * (e.g. http://acme.localhost:5173 or https://acme.elitepic.co.uk).
 */
export function isAllowedFrontendOrigin(origin) {
  if (!origin) return true;

  const allowed = getFrontendOrigins();
  if (allowed.includes(origin)) return true;

  try {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol)) return false;

    const hostname = url.hostname.toLowerCase();
    const platform = getPlatformDomain();

    if (
      hostname === platform ||
      hostname === `www.${platform}` ||
      hostname === `cms.${platform}`
    ) {
      return true;
    }

    const slug = parseOrganisationSlugFromHost(url.host);
    return Boolean(slug);
  } catch {
    return false;
  }
}

/**
 * Dynamic origin for cors + socket.io (credentials require a specific origin).
 */
export function corsOriginDelegate(origin, callback) {
  if (!origin || isAllowedFrontendOrigin(origin)) {
    callback(null, origin || true);
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    logger.warn(`[CORS] Blocked origin: ${origin}`);
  }
  callback(null, false);
}

export function getCorsOptions() {
  return {
    origin: corsOriginDelegate,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Organisation-Slug",
      "X-Requested-With",
      "x-csrf-token",
    ],
    exposedHeaders: ["Content-Disposition"],
    optionsSuccessStatus: 204,
    maxAge: 86400,
  };
}

export function logCorsConfiguration() {
  const origins = getFrontendOrigins();
  logger.info(`CORS platform domain: ${getPlatformDomain()}`);
  logger.info(
    `CORS explicit origins (${origins.length}): ${origins.join(", ") || "(none)"}`,
  );
  logger.info(
    `CORS tenant subdomains: *.${getPlatformDomain()} (allowed via Origin header)`,
  );
}
