import platformDb from "../models/index.js";

const PLATFORM_DOMAIN = () =>
  String(process.env.PLATFORM_DOMAIN || "localhost").toLowerCase();

/**
 * Extract tenant slug from host (e.g. acme.localhost:5173 → acme).
 */
export function parseOrganisationSlugFromHost(host) {
  if (!host) return null;
  const hostname = String(host).split(":")[0].toLowerCase();
  const platform = PLATFORM_DOMAIN();

  if (hostname === platform || hostname === "127.0.0.1") {
    return null;
  }

  const suffix = `.${platform}`;
  if (hostname.endsWith(suffix)) {
    const slug = hostname.slice(0, -suffix.length);
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
 */
export function resolveOrganisationSlugFromRequest(req) {
  const headerSlug = req.headers["x-organisation-slug"];
  if (headerSlug) {
    return String(headerSlug).trim().toLowerCase();
  }

  if (req.body?.organisation_slug) {
    return String(req.body.organisation_slug).trim().toLowerCase();
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

  if (Number(user.role_id) === 5) {
    const err = new Error("Sign in as superadmin from the main platform URL.");
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
