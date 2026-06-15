import path from "path";

// Physical subdirectories under storage/private that are exposed via the
// public static mount at /api/public/images (see app.js). Any uploaded image
// that should be web-visible MUST land in one of these.
export const PUBLIC_IMAGE_SUBDIRS = [
  "organisations",
  "platform",
  "superadmin",
  "avatars",
];

const STORAGE_MARKERS = [
  "storage/private/organisations/",
  "storage/private/platform/",
  "storage/private/superadmin/",
  "storage/private/avatars/",
  "uploads/organisations/",
  "uploads/platform/",
  "uploads/superadmin/",
];

/**
 * Normalizes multer absolute paths to a stable DB-relative storage path.
 * e.g. C:\app\storage\private\organisations\abc.png → storage/private/organisations/abc.png
 */
export function normalizeStorageRelativePath(filePath) {
  if (!filePath) return null;

  let normalized = String(filePath).replace(/\\/g, "/");

  for (const marker of STORAGE_MARKERS) {
    const idx = normalized.indexOf(marker);
    if (idx !== -1) {
      return normalized.slice(idx);
    }
  }

  const basename = path.basename(normalized);
  if (basename && basename !== normalized) {
    if (normalized.includes("/organisations/")) {
      return `storage/private/organisations/${basename}`;
    }
    if (normalized.includes("/platform/")) {
      return `storage/private/platform/${basename}`;
    }
    if (normalized.includes("/superadmin/")) {
      return `storage/private/superadmin/${basename}`;
    }
    if (normalized.includes("/avatars/")) {
      return `storage/private/avatars/${basename}`;
    }
  }

  return normalized;
}

/**
 * Canonical image-URL builder. Converts ANY stored/uploaded image reference to
 * the stable RELATIVE web path served at /api/public/images/<basename>:
 *
 *   - absolute multer path     C:\app\storage\private\avatars\x.jpg
 *   - private storage path     storage/private/superadmin/x.jpg
 *   - legacy upload path       uploads/profile_pics/12/x.jpg
 *   - full URL                 http://host/storage/private/.../x.jpg
 *   - bare basename            x.jpg
 *   → "api/public/images/x.jpg"
 *
 * The frontend's resolveAssetUrl() prepends the API origin, so NOTHING here
 * embeds a host — that keeps stored values portable across domains/ports.
 *
 * Returns null for empty input. Returns the value unchanged only when it is
 * already an absolute http(s) URL that does NOT point at our own storage (e.g.
 * an external/CDN URL) — those are passed through so we never mangle them.
 */
export function toPublicImagePath(input) {
  if (!input) return null;

  let value = String(input).trim();
  if (!value) return null;

  // A full URL that embeds one of our storage segments: strip down to the
  // basename and re-key it. A full URL that does NOT (external/CDN): pass through.
  const isHttp = /^https?:\/\//i.test(value);
  if (isHttp) {
    const lower = value.toLowerCase();
    const ownsAsset =
      lower.includes("/storage/private/") ||
      lower.includes("/uploads/") ||
      lower.includes("/api/public/images/");
    if (!ownsAsset) return value;
  }

  const normalized = value.replace(/\\/g, "/");

  // Already canonical.
  const publicIdx = normalized.indexOf("api/public/images/");
  if (publicIdx !== -1) {
    return normalized.slice(publicIdx);
  }

  // Anything else → take the basename and serve it from the public mount. The
  // basename is unique (uuid_timestamp), so collisions across subdirs are nil.
  const basename = path.basename(normalized.split("?")[0]);
  if (!basename) return null;
  return `api/public/images/${basename}`;
}
