import path from "path";

const STORAGE_MARKERS = [
  "storage/private/organisations/",
  "storage/private/platform/",
  "storage/private/superadmin/",
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
  }

  return normalized;
}
