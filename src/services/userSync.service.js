import platformDb from "../models/index.js";
import { findPlatformUserByEmail, normalizePlatformEmail } from "../utils/platformUserEmail.js";

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
       console.log(`⚠ Conflict resolved: Removed user with same email but different ID in tenant: ${email}`);
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
