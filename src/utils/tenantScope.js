import { Op } from "sequelize";
import db from "../models/index.js";

/**
 * JWT payload fields used across login, OTP verify, and 2FA completion.
 * @param {import("sequelize").Model} user - User instance with organisation_id and role_id
 * @param {{ name?: string } | null} role - Role row or null
 */
export function buildJwtPayload(user, role = null) {
  const roleName = role?.name ?? user.role?.name ?? null;
  const organisation_id =
    user.organisation_id != null && user.organisation_id !== ""
      ? Number(user.organisation_id)
      : null;
  return {
    userId: user.id,
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

/**
 * WHERE fragment for Case queries for the current tenant user.
 * Superadmin (5) returns {} so callers can see all rows if they use superadmin-only routes later.
 * @param {import("express").Request} req
 * @returns {Record<string, unknown>}
 */
export function caseWhereForRequest(req) {
  const rid = Number(req.user?.role_id);
  if (isSuperAdminRole(rid)) return {};
  const oid =
    req.user?.organisation_id != null && req.user?.organisation_id !== ""
      ? Number(req.user.organisation_id)
      : null;
  if (oid == null || Number.isNaN(oid)) return { id: { [Op.eq]: -1 } };
  return { organisation_id: oid };
}

/**
 * Merge tenant case scope into an existing Sequelize where object (shallow merge for top-level keys).
 * @param {import("express").Request} req
 * @param {Record<string, unknown>} where
 */
export function mergeCaseWhere(req, where = {}) {
  const tw = caseWhereForRequest(req);
  return { ...where, ...tw };
}

/**
 * Default organisation for public registration (never trust client-supplied org id on open register).
 */
export async function resolveDefaultOrganisationId() {
  const envId = process.env.DEFAULT_ORGANISATION_ID;
  if (envId !== undefined && envId !== null && String(envId).trim() !== "") {
    const parsed = parseInt(String(envId).trim(), 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const first = await db.Organisation.findOne({
    where: { status: { [Op.in]: ["active", "trial"] } },
    order: [["id", "ASC"]],
  });
  return first?.id ?? null;
}

/**
 * Ensure candidate and sponsor users belong to the same organisation as the requester.
 */
export async function assertUsersInOrganisation(candidateId, sponsorId, organisationId) {
  if (organisationId == null || Number.isNaN(Number(organisationId))) {
    const err = new Error("Invalid organisation context");
    err.status = 403;
    throw err;
  }
  const oid = Number(organisationId);
  const [candidate, sponsor] = await Promise.all([
    db.User.findByPk(candidateId, { attributes: ["id", "organisation_id"] }),
    db.User.findByPk(sponsorId, { attributes: ["id", "organisation_id"] }),
  ]);
  if (!candidate || Number(candidate.organisation_id) !== oid) {
    const err = new Error("Candidate does not belong to your organisation");
    err.status = 403;
    throw err;
  }
  if (!sponsor || Number(sponsor.organisation_id) !== oid) {
    const err = new Error("Sponsor does not belong to your organisation");
    err.status = 403;
    throw err;
  }
}
