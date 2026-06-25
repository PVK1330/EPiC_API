import platformDb from "../models/index.js";

/**
 * Tenant hosts are {slug}.elitepic.co.uk — not {slug}.cms.elitepic.co.uk.
 */
export function normalizePlatformDomain(domain) {
  const d = String(domain || "").toLowerCase().trim();
  if (!d) return "localhost";
  if (d.startsWith("cms.")) return d.slice(4);
  return d;
}

export function getPlatformDomain() {
  const fromEnv = normalizePlatformDomain(process.env.PLATFORM_DOMAIN);
  if (fromEnv !== "localhost") return fromEnv;

  const base = process.env.FRONTEND_URL?.split(",")[0]?.trim();
  if (base) {
    try {
      const host = new URL(base).hostname.toLowerCase();
      if (host === "cms.elitepic.co.uk" || host.endsWith(".elitepic.co.uk")) {
        return "elitepic.co.uk";
      }
    } catch {
      /* ignore */
    }
  }

  return fromEnv;
}

const PLATFORM_DOMAIN = () => getPlatformDomain();

/**
 * Extract tenant slug from host (e.g. acme.localhost:5173 → acme).
 */
export function parseOrganisationSlugFromHost(host) {
  if (!host) return null;
  const hostname = String(host).split(":")[0].toLowerCase();
  const platform = PLATFORM_DOMAIN();

  if (
    hostname === platform ||
    hostname === "127.0.0.1" ||
    hostname === "cms.elitepic.co.uk"
  ) {
    return null;
  }

  const suffix = `.${platform}`;
  if (hostname.endsWith(suffix)) {
    const slug = hostname.slice(0, -suffix.length);
    if (slug && !slug.includes(".")) {
      return slug;
    }
  }

  const cmsSuffix = `.cms.${platform}`;
  if (hostname.endsWith(cmsSuffix)) {
    const slug = hostname.slice(0, -cmsSuffix.length);
    if (slug && !slug.includes(".")) {
      return slug;
    }
  }

  return null;
}

export function parseOrganisationSlugFromOrigin(origin) {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    return parseOrganisationSlugFromHost(url.host);
  } catch {
    return null;
  }
}

/**
 * Resolve tenant slug from API request (header, body, browser origin, or host).
 *
 * S-13 fix: Client-supplied X-Organisation-Slug / organisation_slug are only
 * trusted when the request is already authenticated and the slug matches the
 * session user's own organisation. For unauthenticated flows (login, register,
 * forgot-password, OTP) we derive the slug from the Host/Origin only.
 *
 * The caller (attachOrganisationContext middleware) controls whether auth is
 * required. This function accepts an optional `trustClientSlug` flag
 * (default false) that is only set to true for authenticated routes that have
 * already verified the slug matches the session user.
 */
export function resolveOrganisationSlugFromRequest(req, { trustClientSlug = false } = {}) {
  if (trustClientSlug) {
    const headerSlug = req.headers["x-organisation-slug"];
    if (headerSlug) return String(headerSlug).trim().toLowerCase();

    if (req.body?.organisation_slug) {
      return String(req.body.organisation_slug).trim().toLowerCase();
    }
  }

  const origin = req.headers.origin || req.headers.referer;
  const fromOrigin = parseOrganisationSlugFromOrigin(origin);
  if (fromOrigin) return fromOrigin;

  return parseOrganisationSlugFromHost(req.headers.host);
}

export async function findOrganisationBySlug(slug) {
  if (!slug) return null;
  return platformDb.Organisation.findOne({ where: { slug } });
}

/**
 * @returns {{ slug: string|null, organisation: object|null }}
 */
export async function resolveOrganisationContext(req) {
  const slug = resolveOrganisationSlugFromRequest(req);
  if (!slug) {
    return { slug: null, organisation: null };
  }
  const organisation = await findOrganisationBySlug(slug);
  return { slug, organisation };
}

/**
 * Enforce tenant login rules when request targets an org subdomain.
 */
export function assertLoginAllowedForOrganisationContext(user, ctx) {
  if (!ctx?.organisation) return;

  if (user.organisation_id == null) {
    const err = new Error("Sign in as platform staff from the main platform URL.");
    err.status = 403;
    throw err;
  }

  if (Number(user.organisation_id) !== Number(ctx.organisation.id)) {
    const err = new Error("This account does not belong to this organisation.");
    err.status = 403;
    throw err;
  }
}

export function buildTenantFrontendUrls(slug) {
  const base =
    process.env.FRONTEND_URL?.split(",")[0]?.trim() || "http://localhost:5173";
  let url;
  try {
    url = new URL(base);
  } catch {
    return { subdomain: base, main: base };
  }

  const platform = PLATFORM_DOMAIN();
  const port = url.port ? `:${url.port}` : "";
  const subdomainHost = `${slug}.${platform}${port}`;

  return {
    subdomain: `${url.protocol}//${subdomainHost}`,
    main: base,
  };
}
