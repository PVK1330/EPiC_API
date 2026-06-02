import { Op } from "sequelize";

/** Normalise email for storage and lookup. */
export function normalizePlatformEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * Sequelize `where` for platform users — email is unique per organisation, not globally.
 * Superadmin / platform-only users use organisation_id IS NULL.
 */
export function platformUserEmailWhere(email, organisationId) {
  const emailNorm = normalizePlatformEmail(email);
  if (organisationId != null && organisationId !== "" && !Number.isNaN(Number(organisationId))) {
    return {
      email: emailNorm,
      organisation_id: Number(organisationId),
    };
  }
  return {
    email: emailNorm,
    organisation_id: { [Op.is]: null },
  };
}

export async function findPlatformUserByEmail(platformDb, email, organisationId) {
  if (!platformDb?.User) return null;
  return platformDb.User.findOne({
    where: platformUserEmailWhere(email, organisationId),
  });
}

export async function isPlatformEmailTaken(platformDb, email, organisationId) {
  const row = await findPlatformUserByEmail(platformDb, email, organisationId);
  return Boolean(row);
}

/**
 * Resolve platform user on login — prefer organisation from subdomain when present.
 */
export async function findPlatformUserForLogin(platformDb, email, organisationContext) {
  const emailNorm = normalizePlatformEmail(email);
  const orgId = organisationContext?.organisation?.id;

  if (orgId != null) {
    // Org-scoped (subdomain) login — the exact organisation match is authoritative.
    return findPlatformUserByEmail(platformDb, emailNorm, orgId);
  }

  // No organisation context: the same email can exist across multiple orgs/roles
  // (emails are unique PER organisation, not globally). A stale INACTIVE duplicate
  // (e.g. an org_id=null record) must never shadow a valid active account, or the
  // user gets a false "Account is inactive or suspended." We therefore prefer
  // active accounts at every step and only fall back to an inactive row when no
  // active row exists (so a genuinely inactive account still gets the right error).
  const superadmin = await platformDb.User.findOne({
    where: { email: emailNorm, role_id: 5 },
  });
  if (superadmin) return superadmin;

  // Active platform-staff (org_id IS NULL) takes precedence over an inactive one.
  const activeStaff = await platformDb.User.findOne({
    where: { email: emailNorm, organisation_id: { [Op.is]: null }, status: "active" },
  });
  if (activeStaff) return activeStaff;

  // Any active account for this email (e.g. an org-scoped sponsor/candidate),
  // preferred over an inactive duplicate.
  const activeAny = await platformDb.User.findOne({
    where: { email: emailNorm, status: "active" },
    order: [["id", "ASC"]],
  });
  if (activeAny) return activeAny;

  // Last resort: any matching row (preserves the correct "inactive/suspended"
  // error when the account genuinely is not active).
  const inactiveStaff = await platformDb.User.findOne({
    where: { email: emailNorm, organisation_id: { [Op.is]: null } },
  });
  if (inactiveStaff) return inactiveStaff;

  return platformDb.User.findOne({
    where: { email: emailNorm },
    order: [["id", "ASC"]],
  });
}
