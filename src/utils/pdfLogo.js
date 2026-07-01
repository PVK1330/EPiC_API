/**
 * Shared resolver for the logo used in generated PDFs (data capture sheets, case
 * summary reports, filled application forms, etc.).
 *
 * pdfmake needs image bytes, not a URL. This turns the sending organisation's
 * stored logo into a base64 data URI, falling back to the platform/superadmin
 * logo and finally the bundled brand asset — the same priority the email layer
 * uses (see emailBranding.js).
 */
import path from "path";
import fs from "fs";
import { getOrganisationEmailBranding } from "./emailBranding.js";

/** Bundled brand asset — last-resort fallback when no org/platform logo resolves. */
export function fallbackLogoDataUri() {
  const logoPath = path.join(process.cwd(), "assets", "elitepic_logo.png");
  if (fs.existsSync(logoPath)) {
    const buf = fs.readFileSync(logoPath);
    return `data:image/png;base64,${buf.toString("base64")}`;
  }
  return null;
}

/**
 * Resolve a stored logo reference to a base64 data URI. Handles:
 *   - "storage/private/organisations/abc.jpg"  (org/tenant logo)
 *   - "api/public/images/logo.png"             (platform/superadmin logo)
 *   - any relative path resolvable from CWD
 * Returns null when the file cannot be found.
 */
export function logoDataUriFromPath(rawPath) {
  if (!rawPath || /^https?:/i.test(rawPath)) return null;
  const raw = String(rawPath).replace(/\\/g, "/").replace(/^\/+/, "");
  const basename = path.basename(raw.split("?")[0]);
  if (!basename) return null;

  const candidates = [
    path.resolve(process.cwd(), raw),
    ...["organisations", "platform", "superadmin", "avatars"].map((sub) =>
      path.join(process.cwd(), "storage", "private", sub, basename),
    ),
    path.join(process.cwd(), "uploads", basename),
  ];

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const buf = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
        return `data:${mime};base64,${buf.toString("base64")}`;
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

/**
 * Resolve the org's PDF logo as a data URI: org logo → platform/superadmin logo
 * → bundled fallback. Never throws.
 */
export async function resolveOrgPdfLogoDataUri(organisationId) {
  try {
    const branding = await getOrganisationEmailBranding(organisationId);
    return logoDataUriFromPath(branding?.logoRawPath) || fallbackLogoDataUri();
  } catch {
    return fallbackLogoDataUri();
  }
}
