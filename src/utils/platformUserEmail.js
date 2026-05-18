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
    return findPlatformUserByEmail(platformDb, emailNorm, orgId);
  }

  const superadmin = await platformDb.User.findOne({
    where: { email: emailNorm, role_id: 5 },
  });
  if (superadmin) return superadmin;

  return platformDb.User.findOne({
    where: { email: emailNorm, organisation_id: { [Op.is]: null } },
  });
}
