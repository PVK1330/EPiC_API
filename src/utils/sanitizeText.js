/**
 * Plain-text input sanitiser (defence against stored XSS).
 *
 * For fields that are meant to hold PLAIN TEXT only (chat messages, case notes,
 * category/label names -- NOT rich HTML like CCL / email templates). It removes
 * all HTML tags and stray angle brackets so a payload such as
 * "<script>alert(1)</script>" or "<img src=x onerror=...>" cannot be stored and
 * later executed by any consumer (API client, export, email) regardless of how
 * it is rendered.
 *
 * Tags are stripped iteratively until the string is stable, which defeats the
 * classic split-tag bypass (e.g. "<scr<script>ipt>"). Normal text with no tags
 * passes through unchanged.
 *
 * @param {*} input
 * @param {{ maxLength?: number }} [opts]
 * @returns {string|*} sanitised string, or the original value if it was null/undefined
 */
export function sanitizePlainText(input, { maxLength } = {}) {
  if (input === null || input === undefined) return input;
  let s = String(input);

  // Strip HTML tags repeatedly until no more are removed (handles nested / split tags).
  let prev;
  do {
    prev = s;
    s = s.replace(/<[^>]*>/g, "");
  } while (s !== prev);

  // Remove any remaining angle brackets so no partial markup survives.
  s = s.replace(/[<>]/g, "");

  // Drop control characters, keeping tab (9), newline (10) and carriage return (13).
  s = Array.from(s)
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c === 9 || c === 10 || c === 13 || c >= 32;
    })
    .join("");

  s = s.trim();
  if (maxLength && s.length > maxLength) s = s.slice(0, maxLength);
  return s;
}

export default sanitizePlainText;
