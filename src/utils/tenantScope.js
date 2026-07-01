import { Op } from "sequelize";
import platformDb from "../models/index.js";

/**
 * JWT payload fields used across login, OTP verify, and 2FA completion.
 */
export function buildJwtPayload(user, role = null, allowedModules = null) {
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
    // Plan-based module keys; null on old tokens (middleware fails open gracefully)
    allowedModules: Array.isArray(allowedModules) ? allowedModules : null,
  };
}

/** Superadmin role id (platform; no tenant scope on JWT). */
export function isSuperAdminRole(roleId) {
  return Number(roleId) === 5;
}

export const isPlatformSuperAdminRole = isSuperAdminRole;

/** Platform panel users live on the registry DB with no organisation_id. */
export function isPlatformStaffUser(user) {
  return user != null && (user.organisation_id == null || user.organisation_id === "");
}

/** Organisation id from JWT (null = platform / unscoped within tenant DB). */
export function organisationIdFromRequest(req) {
  const raw = req?.user?.organisation_id;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function organisationScopeCondition(orgId) {
  if (orgId == null) return null;
  return {
    [Op.or]: [{ organisation_id: orgId }, { organisation_id: null }],
  };
}

/** Restrict Sequelize `where` to the requester's organisation (plus legacy null rows). */
export function applyOrganisationScope(where = {}, orgId) {
  const scope = organisationScopeCondition(orgId);
  if (!scope) return where;
  if (!where || Object.keys(where).length === 0) return scope;
  return { [Op.and]: [where, scope] };
}

/** Case list filter for the current admin/caseworker session. */
export function mergeCaseWhere(req, where = {}) {
  return applyOrganisationScope(where, organisationIdFromRequest(req));
}

/** User list filter for the current organisation. */
export function mergeUserWhere(req, where = {}) {
  return applyOrganisationScope(where, organisationIdFromRequest(req));
}

/** @deprecated alias */
export function caseWhereForRequest(req) {
  return mergeCaseWhere(req, {});
}

/** True when a user row belongs to the requester's organisation (or is legacy unscoped). */
export function userBelongsToOrganisation(user, orgId) {
  if (orgId == null || !user) return true;
  const rowOrg = user.organisation_id;
  if (rowOrg == null || rowOrg === "") return true;
  return Number(rowOrg) === orgId;
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
