/**
 * Per-tenant email branding resolver.
 *
 * ElitePic is multi-tenant: every email must carry the sending ORGANISATION's
 * logo + name (and reply-to), while the visual frame stays identical across all
 * tenants (one UK-styled master template — see epicEmailLayout.js).
 *
 * This module turns an `organisationId` into a small, cacheable `branding`
 * object that the master template + the send layer consume:
 *   { isPlatform, orgName, logoUrl(absolute|null), supportEmail, replyTo, portalUrl }
 *
 * When no organisation is in scope (platform staff mail, superadmin diagnostics,
 * SMTP owner receipts) it resolves the PLATFORM identity instead.
 */
import platformDb from "../models/index.js";
import { getSettingsByNamespace } from "../services/settings.service.js";
import { buildTenantFrontendUrls } from "./organisationHost.js";
import logger from "./logger.js";

// ── Fixed UK palette ─────────────────────────────────────────────────────────
// One identity for ALL tenants (navy / GOV.UK blue / GOV.UK red = red·white·blue).
// Exported so anything that renders email-adjacent HTML stays in lockstep.
export const EMAIL_PALETTE = Object.freeze({
  navy: "#0B2E5E",
  navyDark: "#071F40",
  blue: "#1D70B8",
  blueTint: "#EAF0F7",
  ink: "#0B0C0C",
  body: "#33414F",
  muted: "#6B7785",
  border: "#DDE3EA",
  surface: "#FFFFFF",
  pageBg: "#EEF1F5",
  success: "#00703C",
  successBg: "#E7F2EC",
  successBorder: "#B7DCC6",
  warning: "#8A5A00",
  warningBg: "#FFF7E6",
  warningBorder: "#F2D08A",
  danger: "#D4351C",
  dangerBg: "#FBE9E6",
  dangerBorder: "#F3B6AC",
  unionRed: "#C8102E",
});

const PLATFORM_NAME_FALLBACK = "ImCamHub";
const CACHE_TTL_MS = 5 * 60 * 1000;

/** orgId(or "platform") -> { value, expires } */
const cache = new Map();

function baseUrl() {
  return String(process.env.BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
}

function mainPortalUrl() {
  const base =
    process.env.FRONTEND_URL?.split(",")[0]?.trim() || "http://localhost:5173";
  return `${base.replace(/\/+$/, "")}/login`;
}

/**
 * Turn a stored image reference into an absolute URL email clients can fetch.
 * Relative 'api/public/images/<basename>' -> '<BASE_URL>/api/public/images/<basename>'.
 * Already-absolute (CDN) URLs pass through unchanged. Empty -> null.
 */
export function absoluteImageUrl(input) {
  if (!input) return null;
  const v = String(input).trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return `${baseUrl()}/${v.replace(/^\/+/, "")}`;
}

/** Platform fallback logo — physically present at assets/elitepic_logo.png. */
export function platformFallbackLogoUrl() {
  return `${baseUrl()}/assets/elitepic_logo.png`;
}

async function resolvePlatformBranding() {
  let identity = {};
  try {
    identity = (await getSettingsByNamespace(null)) || {};
  } catch (err) {
    logger.warn({ err }, "[emailBranding] platform identity settings unavailable");
  }

  const name =
    String(identity.platform_name || process.env.PLATFORM_NAME || PLATFORM_NAME_FALLBACK).trim() ||
    PLATFORM_NAME_FALLBACK;
  const support = String(identity.support_email || "").trim() || null;
  const logoUrl = absoluteImageUrl(identity.logo_url) || platformFallbackLogoUrl();

  return {
    isPlatform: true,
    orgName: name,
    logoUrl,
    supportEmail: support,
    replyTo: support,
    portalUrl: mainPortalUrl(),
  };
}

async function resolveOrgBranding(organisationId) {
  const org = await platformDb.Organisation.findByPk(organisationId, {
    attributes: ["id", "name", "slug", "logoUrl", "primaryEmail"],
  });
  if (!org) return resolvePlatformBranding();

  const platform = await resolvePlatformBranding();

  let portalUrl = platform.portalUrl;
  try {
    if (org.slug) {
      const { subdomain } = buildTenantFrontendUrls(org.slug);
      portalUrl = `${subdomain.replace(/\/+$/, "")}/login`;
    }
  } catch {
    /* keep platform portal fallback */
  }

  const support = String(org.primaryEmail || "").trim() || platform.supportEmail;

  return {
    isPlatform: false,
    orgName: String(org.name || "").trim() || platform.orgName,
    // null when the org has no logo → template falls back to the org-name wordmark
    // (we deliberately do NOT show the EPiC platform logo on a tenant's mail).
    logoUrl: absoluteImageUrl(org.logoUrl),
    supportEmail: support,
    replyTo: support,
    portalUrl,
  };
}

/**
 * Resolve branding for an organisation (or the platform when id is null/0).
 * Always resolves to a usable object — never throws.
 */
export async function getOrganisationEmailBranding(organisationId) {
  const idNum = organisationId != null ? Number(organisationId) : NaN;
  const key = Number.isFinite(idNum) && idNum > 0 ? `org:${idNum}` : "platform";

  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value;
  try {
    value = key === "platform" ? await resolvePlatformBranding() : await resolveOrgBranding(idNum);
  } catch (err) {
    logger.error({ err, organisationId }, "[emailBranding] resolve failed — using platform fallback");
    value = {
      isPlatform: true,
      orgName: PLATFORM_NAME_FALLBACK,
      logoUrl: platformFallbackLogoUrl(),
      supportEmail: null,
      replyTo: null,
      portalUrl: mainPortalUrl(),
    };
  }

  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Drop cached branding (call after an org logo/name change). */
export function clearEmailBrandingCache(organisationId = null) {
  if (organisationId == null) {
    cache.clear();
    return;
  }
  cache.delete(`org:${Number(organisationId)}`);
}

/** Escape text for safe inclusion in HTML. */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain text → safe inner HTML (escaped, newlines → <br>). */
export function textToInnerHtml(text) {
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

/** True when an HTML string is already a full document (so it must not be re-framed). */
export function isFullHtmlDocument(html) {
  return typeof html === "string" && /<\s*(?:!doctype|html)[\s>]/i.test(html);
}
