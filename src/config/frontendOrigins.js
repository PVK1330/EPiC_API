import { parseOrganisationSlugFromHost } from "../utils/organisationHost.js";

/**
 * FRONTEND_URL may be comma-separated (e.g. Vite + CRA ports).
 * Used by Express CORS and Socket.IO so both match the browser origin.
 */
export function getFrontendOrigins() {
  const raw =
    process.env.FRONTEND_URL ||
    "http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:3000";
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

/**
 * Allow main app origins and tenant subdomains (e.g. http://acme.localhost:5173).
 */
export function isAllowedFrontendOrigin(origin) {
  if (!origin) return true;

  const allowed = getFrontendOrigins();
  if (allowed.includes(origin)) return true;

  try {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const slug = parseOrganisationSlugFromHost(url.host);
    return Boolean(slug);
  } catch {
    return false;
  }
}

export function corsOriginDelegate(origin, callback) {
  if (isAllowedFrontendOrigin(origin)) {
    callback(null, true);
  } else {
    callback(new Error(`CORS blocked origin: ${origin}`));
  }
}
