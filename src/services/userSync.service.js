import { Op } from "sequelize";
import platformDb from "../models/index.js";
import {
  findPlatformUserByEmail,
  normalizePlatformEmail,
  platformUserEmailWhere,
} from "../utils/platformUserEmail.js";
import logger from "../utils/logger.js";

/**
 * Mirror a user row into the tenant database (same primary key as platform registry).
 */
export async function mirrorUserToTenant(tenantDb, userInstanceOrPlain) {
  const plain =
    typeof userInstanceOrPlain?.get === "function"
      ? userInstanceOrPlain.get({ plain: true })
      : { ...userInstanceOrPlain };

  const { id, email, createdAt, updatedAt, ...rest } = plain;
  if (id == null) throw new Error("mirrorUserToTenant requires user id");

  // Check by PK first
  const existingByPk = await tenantDb.User.findByPk(id);
  if (existingByPk) {
    await existingByPk.update({ email, ...rest });
    return existingByPk;
  }

  // Check by Email (in case ID mismatch due to legacy/out-of-sync)
  if (email) {
    const existingByEmail = await tenantDb.User.findOne({ where: { email } });
    if (existingByEmail) {
       // If ID is different, we have a conflict. Since Registry is the source of truth, we delete the tenant one.
       await existingByEmail.destroy();
       logger.warn({ email }, "Conflict resolved: Removed user with same email but different ID in tenant");
    }
  }

  return tenantDb.User.create({ id, email, ...rest });
}

/**
 * Create user in platform registry then mirror into tenant.
 */
export async function createUserOnPlatformAndTenant(tenantDb, userData) {
  const { organisation_id } = userData;
  if (!organisation_id) {
    throw new Error("organisation_id is required to create a tenant-scoped user");
  }

  // 1. Create on Platform Registry
  const mainUser = await platformDb.User.create(userData);

  // 2. Mirror to Tenant DB
  try {
    await mirrorUserToTenant(tenantDb, mainUser);
  } catch (err) {
    // Cleanup platform user if tenant mirroring fails to maintain consistency
    await mainUser.destroy();
    throw err;
  }

  return mainUser;
}

/**
 * Update user on platform and tenant (password, profile, status, etc.).
 */
export async function syncUserToPlatformAndTenant(tenantDb, userId, updates) {
  await platformDb.User.update(updates, { where: { id: userId } });
  await tenantDb.User.update(updates, { where: { id: userId } });
}

/**
 * Mirror profile/auth fields to the platform registry only (tenant row already updated).
 * Times out quickly so API handlers are not blocked by a slow central DB connection.
 */
export async function syncUserToPlatformOnly(userId, updates, timeoutMs = 4000) {
  if (!updates || Object.keys(updates).length === 0) return;

  const syncPromise = platformDb.User.update(updates, { where: { id: userId } });

  if (!timeoutMs || timeoutMs <= 0) {
    await syncPromise;
    return;
  }

  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Platform user sync timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  try {
    await Promise.race([syncPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * BUG-002: mirror identity fields (email, name, mobile, status) to the platform
 * registry, healing rows whose ids diverged from the tenant. Matches by
 * (id + organisation) first; when nothing matches — a legacy row created with a
 * different platform PK — falls back to the row currently holding the user's
 * previous email in that organisation. Without the fallback, an email change
 * left the old address stuck on the stale platform row forever, which then
 * blocked the address from ever being used again.
 */
export async function syncUserIdentityToPlatform(userId, organisationId, previousEmail, updates) {
  if (!updates || Object.keys(updates).length === 0) return;

  const where = organisationId != null
    ? { id: userId, organisation_id: organisationId }
    : { id: userId };
  const [updatedById] = await platformDb.User.update(updates, { where });
  if (updatedById > 0) return;

  const prevNorm = normalizePlatformEmail(previousEmail);
  if (prevNorm && organisationId != null) {
    await platformDb.User.update(updates, {
      where: platformUserEmailWhere(prevNorm, organisationId),
    });
  }
}

/**
 * BUG-002: deleting a record must FREE its email and mobile so they can be used
 * again — both users tables carry hard unique indexes, so a soft-deleted row
 * otherwise occupies the address forever ("a new one is required instead").
 * The record is kept for audit: the email is rewritten to a unique tombstone
 * that still contains the original address, the mobile is cleared, and the same
 * is applied to the platform mirror (by id + org, falling back to email + org).
 */
const EMAIL_TOMBSTONE_RE = /^(.*)\+deleted(\d+)\.(\d+)@([^@]+)$/;

/**
 * Values that free a user's email/mobile while keeping the row for audit.
 * Email becomes `<local>+deleted<id>.<ts>@<domain>` — still a valid address
 * (passes isEmail, local part kept within 64 chars), unique per user, and
 * the original address stays readable. Mobile is NOT NULL on the users tables
 * (VARCHAR(20)), so it gets a short per-user tombstone that cannot collide
 * with a real dialled number. Idempotent for an already-tombstoned email.
 */
export function buildIdentifierTombstone(userId, email) {
  const originalEmail = normalizePlatformEmail(email);
  const mobile = `del${userId}`;
  if (EMAIL_TOMBSTONE_RE.test(originalEmail)) {
    return { email: originalEmail, mobile, status: "inactive" };
  }
  const at = originalEmail.lastIndexOf("@");
  const local = at > 0 ? originalEmail.slice(0, at) : originalEmail || "unknown";
  const domain = at > 0 ? originalEmail.slice(at + 1) : "deleted.invalid";
  const tag = `+deleted${userId}.${Date.now()}`;
  const localTrimmed = local.slice(0, Math.max(1, 64 - tag.length));
  return { email: `${localTrimmed}${tag}@${domain}`, mobile, status: "inactive" };
}

export async function releaseUserIdentifiersOnDelete(tenantUser, organisationId) {
  const originalEmail = normalizePlatformEmail(tenantUser.email);
  const release = buildIdentifierTombstone(tenantUser.id, originalEmail);
  const tombstone = release.email;

  await tenantUser.update(release);

  const where = organisationId != null
    ? { id: tenantUser.id, organisation_id: organisationId }
    : { id: tenantUser.id };
  const [updatedById] = await platformDb.User.update(release, { where });
  if (updatedById === 0 && originalEmail && organisationId != null) {
    await platformDb.User.update(release, {
      where: platformUserEmailWhere(originalEmail, organisationId),
    });
  }
  return tombstone;
}

/**
 * BUG-002: the admin UI's trash action is a reversible DEACTIVATE (status =
 * inactive via update / toggle-status), so the deactivated row keeps its
 * email + mobile — and the hard unique indexes then block any new record from
 * using them ("a new one is required instead"). Before a create/update's
 * duplicate checks, release the identifiers of any holder that is INACTIVE.
 * Active holders are left alone so the caller still reports a real conflict.
 * Also tombstones stale platform-only mirrors (legacy rows with no tenant twin).
 * Returns the ids that were released.
 */
export async function reclaimIdentifiersFromInactiveUsers(
  tenantDb,
  organisationId,
  { email, countryCode, mobile, excludeUserId } = {},
) {
  const emailNorm = normalizePlatformEmail(email);
  const mobileNorm = mobile != null ? String(mobile).trim().replace(/\s+/g, "") : "";
  const ccNorm = countryCode != null ? String(countryCode).trim() : "";
  const exclude = excludeUserId != null ? Number(excludeUserId) : null;
  const notSelf = exclude != null ? { id: { [Op.ne]: exclude } } : {};
  const released = [];

  const holders = [];
  if (emailNorm && tenantDb?.User) {
    const { sequelize } = tenantDb;
    holders.push(
      ...(await tenantDb.User.findAll({
        where: {
          [Op.and]: [
            sequelize.where(sequelize.fn("LOWER", sequelize.col("email")), emailNorm),
            notSelf,
          ],
        },
      })),
    );
  }
  if (mobileNorm && tenantDb?.User) {
    holders.push(
      ...(await tenantDb.User.findAll({
        where: { mobile: mobileNorm, ...(ccNorm ? { country_code: ccNorm } : {}), ...notSelf },
      })),
    );
  }

  const seen = new Set();
  for (const holder of holders) {
    if (seen.has(holder.id)) continue;
    seen.add(holder.id);
    if (String(holder.status).toLowerCase() !== "inactive") continue;
    await releaseUserIdentifiersOnDelete(holder, organisationId);
    released.push(holder.id);
  }

  if (emailNorm && organisationId != null) {
    const platformHolders = await platformDb.User.findAll({
      where: { ...platformUserEmailWhere(emailNorm, organisationId), ...notSelf },
    });
    for (const row of platformHolders) {
      if (String(row.status).toLowerCase() !== "inactive") continue;
      await row.update(buildIdentifierTombstone(row.id, row.email));
      released.push(`platform:${row.id}`);
    }
  }

  if (released.length) {
    logger.info({ organisationId, released, emailNorm }, "BUG-002: reclaimed identifiers from inactive users");
  }
  return released;
}

/**
 * Register a tenant-only user on the platform registry (legacy rows created before sync).
 * Preserves tenant user id when the platform PK is free; otherwise creates a new platform row.
 */
export async function ensureUserOnPlatformFromTenant(tenantDb, tenantUserId, organisationId) {
  const tenantUser = await tenantDb.User.findByPk(tenantUserId);
  if (!tenantUser) return null;

  const email = normalizePlatformEmail(tenantUser.email);
  if (!email) return null;

  const existingByEmail = await findPlatformUserByEmail(platformDb, email, organisationId);
  if (existingByEmail) {
    if (organisationId && !existingByEmail.organisation_id) {
      await existingByEmail.update({ organisation_id: organisationId });
    }
    return existingByEmail;
  }

  const plain = tenantUser.get({ plain: true });
  const { id, email: _e, createdAt, updatedAt, ...rest } = plain;
  const orgId = organisationId ?? plain.organisation_id ?? null;

  if (orgId && !plain.organisation_id) {
    await tenantDb.User.update({ organisation_id: orgId }, { where: { id: tenantUserId } });
  }

  const existingById = await platformDb.User.findByPk(id);
  if (existingById) {
    const existingEmail = String(existingById.email || "").trim().toLowerCase();
    if (existingEmail === email) {
      if (orgId && !existingById.organisation_id) {
        await existingById.update({ organisation_id: orgId });
      }
      return existingById;
    }
    // Platform PK already used by another account — create registry row without forcing id
    return platformDb.User.create({
      email,
      ...rest,
      organisation_id: orgId,
    });
  }

  return platformDb.User.create({
    id,
    email,
    ...rest,
    organisation_id: orgId,
  });
}

/**
 * Mirror auth fields to the tenant user matched by email (handles platform/tenant id mismatch).
 */
export async function mirrorAuthFieldsToTenantByEmail(tenantDb, platformUser, updates) {
  if (!tenantDb || !platformUser) return;

  const email = String(platformUser.email || "").trim().toLowerCase();
  if (!email) return;

  const tenantUser = await tenantDb.User.findOne({ where: { email } });
  if (tenantUser) {
    await tenantUser.update(updates);
    return;
  }

  if (platformUser.id != null) {
    await tenantDb.User.update(updates, { where: { id: platformUser.id } }).catch(() => {});
  }
}
