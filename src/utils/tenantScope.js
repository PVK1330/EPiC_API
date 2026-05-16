import { Op } from "sequelize";
import platformDb from "../models/index.js";

/**
 * JWT payload fields used across login, OTP verify, and 2FA completion.
 */
export function buildJwtPayload(user, role = null) {
  const roleName = role?.name ?? user.role?.name ?? null;
  const organisation_id =
    user.organisation_id != null && user.organisation_id !== ""
      ? Number(user.organisation_id)
      : null;
  return {
    id: user.id,          // Used by auth.middleware.js
    userId: user.id,      // Legacy/Module compatibility
    email: user.email,
    role_id: Number(user.role_id),
    role_name: roleName,
    organisation_id: Number.isNaN(organisation_id) ? null : organisation_id,
  };
}

/** Superadmin role id (platform; no tenant scope on JWT). */
export function isSuperAdminRole(roleId) {
  return Number(roleId) === 5;
}

/** DB-per-tenant: no row-level org filter needed on case queries. */
export function caseWhereForRequest(_req) {
  return {};
}

/** @deprecated DB-per-tenant — returns `where` unchanged. */
export function mergeCaseWhere(_req, where = {}) {
  return where;
}

/**
 * Default organisation for public registration (platform registry).
 */
export async function resolveDefaultOrganisationId() {
  const envId = process.env.DEFAULT_ORGANISATION_ID;
  if (envId !== undefined && envId !== null && String(envId).trim() !== "") {
    const parsed = parseInt(String(envId).trim(), 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const first = await platformDb.Organisation.findOne({
    where: { status: { [Op.in]: ["active", "trial"] } },
    order: [["id", "ASC"]],
  });
  return first?.id ?? null;
}

/**
 * Ensure candidate and sponsor exist in tenant DB (physical isolation).
 */
export async function assertUsersInOrganisation(tenantDb, candidateId, sponsorId) {
  const [candidate, sponsor] = await Promise.all([
    tenantDb.User.findByPk(candidateId, { attributes: ["id"] }),
    tenantDb.User.findByPk(sponsorId, { attributes: ["id"] }),
  ]);
  if (!candidate) {
    const err = new Error("Candidate not found");
    err.status = 404;
    throw err;
  }
  if (!sponsor) {
    const err = new Error("Sponsor not found");
    err.status = 404;
    throw err;
  }
}
