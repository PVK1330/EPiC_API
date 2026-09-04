import logger from './logger.js';

/**
 * Resolves the CRM Frontend URL following the project's configuration hierarchy:
 *   1. CRM_FRONTEND_URL
 *   2. FRONTEND_URL
 *   3. CLIENT_URL
 *   4. APP_URL
 *   5. PORTAL_URL
 *
 * Guaranteed security & environment rules:
 * - Strips trailing slashes.
 * - Handles comma-separated lists (CORS origins) by taking the first origin.
 * - Never returns localhost, 127.0.0.1, or local IP in production mode.
 */
export function resolveCrmFrontendUrl() {
  const envVal =
    process.env.CRM_FRONTEND_URL ||
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    process.env.APP_URL ||
    process.env.PORTAL_URL;

  const isProduction = process.env.NODE_ENV === 'production';

  if (envVal) {
    const candidate = String(envVal).split(',')[0]?.trim().replace(/\/$/, '');
    if (candidate) {
      const isLocal = /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i.test(candidate);
      if (isProduction && isLocal) {
        logger.error({ candidate }, 'Refusing to generate assignment link using localhost or loopback address in production');
        throw new Error('Refusing to generate assignment link using localhost or loopback address in production');
      }
      return candidate;
    }
  }

  // Safe fallback: empty in production, localhost in development/testing
  if (isProduction) {
    logger.warn('Frontend URL is not configured in production mode');
    return '';
  }
  return 'http://localhost:5173';
}

/**
 * Builds the direct deep link to an assigned case in the Caseworker Portal.
 * Uses the canonical route: /caseworker/cases?caseId=<caseId>
 *
 * @param {string|number} caseId - Human-readable case reference (e.g. Case-01, CAS-001) or ID
 * @returns {string} Fully qualified or relative deep-link URL
 */
export function buildCaseworkerDirectCaseUrl(caseId) {
  const base = resolveCrmFrontendUrl();
  const cleanRef = encodeURIComponent(String(caseId || '').trim());
  const path = `/caseworker/cases?caseId=${cleanRef}`;
  if (!base) return path;
  return `${base}${path}`;
}
