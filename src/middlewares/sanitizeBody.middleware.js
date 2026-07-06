import { sanitizePlainText } from "../utils/sanitizeText.js";

/**
 * Deep plain-text sanitiser for request bodies (defence against stored XSS).
 *
 * Recursively walks req.body and strips HTML from string values, EXCEPT keys
 * that legitimately hold credentials, opaque tokens, or rich content. Use on
 * routers whose payloads are plain text (names, addresses, free-text notes) —
 * e.g. the sponsor panel — NOT on routers that accept rich HTML (CCL / email
 * templates).
 */
const SKIP_KEYS = /(pass(word)?|token|secret|otp|hash|signature|_html$|^html$|^content_html$|template|^body_html$)/i;
const MAX_DEPTH = 6;

function walk(obj, depth) {
  if (obj == null || depth > MAX_DEPTH || typeof obj !== "object") return;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === "string") {
      if (!SKIP_KEYS.test(key)) {
        obj[key] = sanitizePlainText(val, { maxLength: 20000 });
      }
    } else if (val && typeof val === "object") {
      walk(val, depth + 1);
    }
  }
}

export function sanitizeBody(req, _res, next) {
  try {
    if (req.body && typeof req.body === "object") walk(req.body, 0);
  } catch {
    /* never block the request on a sanitiser hiccup */
  }
  next();
}

export default sanitizeBody;
