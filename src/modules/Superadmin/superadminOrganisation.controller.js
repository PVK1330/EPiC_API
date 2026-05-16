import { Op } from 'sequelize';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import platformDb from '../../models/index.js';
import { buildJwtPayload } from '../../utils/tenantScope.js';
import {
  buildPhysicalTenantDatabaseName,
  createTenantPostgresDatabase,
  syncTenantDatabaseSchema,
  dropTenantPostgresDatabase,
  resolveOrganisationDatabaseName,
} from '../../services/tenantDatabaseProvision.service.js';
import { getTenantDb, evictTenantDb } from '../../services/tenantDb.service.js';
import { seedTenantDefaults, seedTenantOrganisation } from '../../services/tenantSeed.service.js';
import { createUserOnPlatformAndTenant } from '../../services/userSync.service.js';
import { buildTenantFrontendUrls } from '../../utils/organisationHost.js';
import {
  generateOrganisationAdminPassword,
  sendOrganisationAdminWelcomeEmail,
} from '../../services/organisationMail.service.js';

const Organisation = platformDb.Organisation;
const User = platformDb.User;
const Plan = platformDb.Plan;

const ROLE_NAMES = {
  1: "candidate",
  2: "caseworker",
  3: "admin",
  4: "business",
  5: "superadmin",
};

async function resolvePlanId(planId, planName) {
  if (planId != null && planId !== "") {
    const parsed = parseInt(String(planId), 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (!planName) return null;
  const key = String(planName).trim().toLowerCase();
  const aliases = {
    starter: "Starter",
    pro: "Professional",
    professional: "Professional",
    enterprise: "Enterprise",
  };
  const name = aliases[key] || String(planName).trim();
  const row = await Plan.findOne({ where: { name } });
  return row?.id ?? null;
}

function slugify(name) {
  const s = String(name || "org")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
  return s || "org";
}

function isValidSlug(slug) {
  return /^[a-z][a-z0-9-]{1,89}$/.test(slug) && !slug.includes("--");
}

async function setOrganisationUsersStatus(org, status) {
  const users = await User.findAll({
    where: { organisation_id: org.id },
    attributes: ["id"],
  });
  await User.update({ status }, { where: { organisation_id: org.id } });

  if (!org.database_name && !org.slug) return;

  try {
    const dbName = await resolveOrganisationDatabaseName(org);
    const tenantDb = getTenantDb(dbName);
    const ids = users.map((u) => u.id);
    if (ids.length) {
      await tenantDb.User.update({ status }, { where: { id: ids } });
    }
  } catch (syncErr) {
    console.warn("Tenant user status sync:", syncErr.message);
  }
}

async function dropAllOrganisationTenantDatabases(org) {
  const names = new Set();
  if (org.database_name?.trim()) names.add(org.database_name.trim());
  try {
    const resolved = await resolveOrganisationDatabaseName(org);
    if (resolved) names.add(resolved);
  } catch (_) {
    /* ignore */
  }
  names.add(buildPhysicalTenantDatabaseName(org.slug));

  for (const dbName of names) {
    try {
      await dropTenantPostgresDatabase(dbName);
      evictTenantDb(dbName);
    } catch (dropErr) {
      console.warn(`drop tenant db ${dbName}:`, dropErr.message);
    }
  }
}

export const listOrganisations = async (req, res) => {
  try {
    const rows = await Organisation.findAll({
      order: [["id", "ASC"]],
      include: [
        {
          model: User,
          as: "users",
          attributes: ["id", "email", "role_id", "status", "first_name", "last_name"],
          required: false,
        },
        {
          model: Plan,
          as: "plan",
          attributes: ["id", "name"],
          required: false,
        },
      ],
    });
    return res.status(200).json({
      status: "success",
      message: "Organisations retrieved",
      data: { organisations: rows },
    });
  } catch (err) {
    console.error("listOrganisations", err);
    return res.status(500).json({
      status: "error",
      message: "Failed to list organisations",
      data: null,
    });
  }
};

export const getOrganisationById = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ status: "error", message: "Invalid id", data: null });
    }
    const org = await Organisation.findByPk(id, {
      include: [
        {
          model: User,
          as: "users",
          attributes: ["id", "email", "role_id", "status", "first_name", "last_name", "mobile"],
          required: false,
        },
        {
          model: Plan,
          as: "plan",
          attributes: ["id", "name", "price", "billing_cycle"],
          required: false,
        },
      ],
    });
    if (!org) {
      return res.status(404).json({ status: "error", message: "Organisation not found", data: null });
    }
    const plain = org.get({ plain: true });
    return res.status(200).json({
      status: "success",
      message: "Organisation retrieved",
      data: {
        organisation: {
          ...plain,
          tenant_urls: buildTenantFrontendUrls(plain.slug),
        },
      },
    });
  } catch (err) {
    console.error("getOrganisationById", err);
    return res.status(500).json({
      status: "error",
      message: err?.message || "Failed to get organisation",
      data: null,
    });
  }
};

export const createOrganisation = async (req, res) => {
  let databaseName = null;
  try {
    const { name, slug, plan_id, plan, status, primaryEmail, country } = req.body;
    const resolvedPlanId = await resolvePlanId(plan_id, plan);
    if (!name || !primaryEmail) {
      return res.status(400).json({
        status: "error",
        message: "name and primaryEmail are required",
        data: null,
      });
    }

    const finalSlug = slug ? slugify(String(slug).trim()) : slugify(name);
    if (!isValidSlug(finalSlug)) {
      return res.status(400).json({
        status: "error",
        message:
          "Invalid subdomain. Use 2–90 lowercase letters, numbers, and hyphens (e.g. acme-immigration).",
        data: null,
      });
    }

    const exists = await Organisation.findOne({ where: { slug: finalSlug } });
    if (exists) {
      return res.status(409).json({
        status: "error",
        message: `Subdomain "${finalSlug}" is already in use. Edit the subdomain or delete the existing organisation.`,
        data: null,
      });
    }

    databaseName = buildPhysicalTenantDatabaseName(finalSlug);
    await createTenantPostgresDatabase(databaseName);
    try {
      await syncTenantDatabaseSchema(databaseName);
    } catch (syncErr) {
      await dropTenantPostgresDatabase(databaseName);
      throw syncErr;
    }

    const org = await Organisation.create({
      name: String(name).trim(),
      slug: finalSlug,
      plan_id: resolvedPlanId,
      status: status || "trial",
      primaryEmail: String(primaryEmail).trim().toLowerCase(),
      country: country || null,
      database_name: databaseName,
    });

    const tenantDb = getTenantDb(databaseName);
    await seedTenantDefaults(tenantDb);
    await seedTenantOrganisation(tenantDb, org);

    const tenant_urls = buildTenantFrontendUrls(finalSlug);

    return res.status(201).json({
      status: "success",
      message: "Organisation created with dedicated PostgreSQL database (schema synced and seeded).",
      data: {
        organisation: org,
        tenant_database: databaseName,
        tenant_urls,
        login_hint:
          `Users can sign in at ${tenant_urls.subdomain} (subdomain) or ${tenant_urls.main} (main domain).`,
      },
    });
  } catch (err) {
    if (databaseName) {
      try {
        await dropTenantPostgresDatabase(databaseName);
        evictTenantDb(databaseName);
      } catch (_) {
        /* ignore rollback errors */
      }
    }
    console.error("createOrganisation", err);
    return res.status(500).json({
      status: "error",
      message: err?.message || "Failed to create organisation",
      data: null,
    });
  }
};

export const updateOrganisation = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ status: "error", message: "Invalid id", data: null });
    }
    const org = await Organisation.findByPk(id);
    if (!org) {
      return res.status(404).json({ status: "error", message: "Organisation not found", data: null });
    }
    const { name, slug, plan_id, plan, status, primaryEmail, country } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (slug !== undefined) updates.slug = String(slug).trim().toLowerCase();
    if (plan_id !== undefined || plan !== undefined) {
      updates.plan_id = await resolvePlanId(plan_id, plan);
    }
    if (status !== undefined) updates.status = status;
    if (primaryEmail !== undefined) updates.primaryEmail = String(primaryEmail).trim().toLowerCase();
    if (country !== undefined) updates.country = country;
    if (updates.slug && updates.slug !== org.slug) {
      const clash = await Organisation.findOne({
        where: { slug: updates.slug, id: { [Op.ne]: id } },
      });
      if (clash) {
        return res.status(400).json({ status: "error", message: "Slug already in use", data: null });
      }
    }
    const previousStatus = org.status;
    await org.update(updates);
    await org.reload();

    if (updates.status && updates.status !== previousStatus) {
      if (updates.status === "suspended") {
        await setOrganisationUsersStatus(org, "inactive");
      } else if (["active", "trial"].includes(updates.status)) {
        await setOrganisationUsersStatus(org, "active");
      }
    }

    if (org.database_name) {
      try {
        const tenantDb = getTenantDb(org.database_name);
        await seedTenantOrganisation(tenantDb, org);
      } catch (syncErr) {
        console.warn("Tenant org mirror after update:", syncErr.message);
      }
    }

    const refreshed = await Organisation.findByPk(id, {
      include: [{ model: Plan, as: "plan", attributes: ["id", "name"] }],
    });

    return res.status(200).json({
      status: "success",
      message: "Organisation updated",
      data: { organisation: refreshed },
    });
  } catch (err) {
    console.error("updateOrganisation", err);
    return res.status(500).json({
      status: "error",
      message: err?.message || "Failed to update organisation",
      data: null,
    });
  }
};

export const deleteOrganisation = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ status: "error", message: "Invalid id", data: null });
    }
    const org = await Organisation.findByPk(id);
    if (!org) {
      return res.status(404).json({ status: "error", message: "Organisation not found", data: null });
    }

    await dropAllOrganisationTenantDatabases(org);
    await User.destroy({ where: { organisation_id: id } });
    await org.destroy();

    return res.status(200).json({
      status: "success",
      message:
        "Organisation permanently deleted. All platform users and the dedicated tenant database were removed.",
      data: null,
    });
  } catch (err) {
    console.error("deleteOrganisation", err);
    return res.status(500).json({
      status: "error",
      message: err?.message || "Failed to delete organisation",
      data: null,
    });
  }
};

export const suspendOrganisation = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ status: "error", message: "Invalid id", data: null });
    }
    const org = await Organisation.findByPk(id);
    if (!org) {
      return res.status(404).json({ status: "error", message: "Organisation not found", data: null });
    }
    await org.update({ status: "suspended" });
    await setOrganisationUsersStatus(org, "inactive");

    const refreshed = await Organisation.findByPk(id, {
      include: [{ model: Plan, as: "plan", attributes: ["id", "name"] }],
    });

    return res.status(200).json({
      status: "success",
      message: "Organisation suspended. All users are deactivated and cannot sign in.",
      data: { organisation: refreshed },
    });
  } catch (err) {
    console.error("suspendOrganisation", err);
    return res.status(500).json({
      status: "error",
      message: err?.message || "Failed to suspend organisation",
      data: null,
    });
  }
};

export const activateOrganisation = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ status: "error", message: "Invalid id", data: null });
    }
    const org = await Organisation.findByPk(id);
    if (!org) {
      return res.status(404).json({ status: "error", message: "Organisation not found", data: null });
    }
    const nextStatus = org.status === "trial" ? "trial" : "active";
    await org.update({ status: nextStatus });
    await setOrganisationUsersStatus(org, "active");

    const refreshed = await Organisation.findByPk(id, {
      include: [{ model: Plan, as: "plan", attributes: ["id", "name"] }],
    });

    return res.status(200).json({
      status: "success",
      message: "Organisation reactivated. Users can sign in again.",
      data: { organisation: refreshed },
    });
  } catch (err) {
    console.error("activateOrganisation", err);
    return res.status(500).json({
      status: "error",
      message: err?.message || "Failed to activate organisation",
      data: null,
    });
  }
};

/**
 * Create the first org admin for a tenant (superadmin only).
 */
/**
 * Superadmin "Login as" — issue JWT for the organisation's primary admin.
 */
export const impersonateOrganisationAdmin = async (req, res) => {
  try {
    const orgId = parseInt(req.params.id, 10);
    if (Number.isNaN(orgId)) {
      return res.status(400).json({ status: "error", message: "Invalid organisation id", data: null });
    }

    const org = await Organisation.findByPk(orgId, {
      attributes: ["id", "name", "slug", "status", "database_name"],
    });
    if (!org) {
      return res.status(404).json({ status: "error", message: "Organisation not found", data: null });
    }
    if (org.status === "suspended") {
      return res.status(403).json({ status: "error", message: "Organisation is suspended", data: null });
    }
    if (!org.database_name) {
      return res.status(503).json({
        status: "error",
        message: "Tenant database not provisioned for this organisation",
        data: null,
      });
    }

    let adminUser = await User.findOne({
      where: { organisation_id: orgId, role_id: 3, status: "active" },
      order: [["id", "ASC"]],
    });

    if (!adminUser) {
      adminUser = await User.findOne({
        where: { organisation_id: orgId, status: "active" },
        order: [["role_id", "ASC"], ["id", "ASC"]],
      });
    }

    if (!adminUser) {
      return res.status(404).json({
        status: "error",
        message: "No active user found for this organisation. Create an organisation admin first.",
        data: null,
      });
    }

    const role = { name: ROLE_NAMES[adminUser.role_id] ?? "admin" };
    const payload = buildJwtPayload(adminUser, role);
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "4h" });

    const tenant_urls = buildTenantFrontendUrls(org.slug);

    return res.status(200).json({
      status: "success",
      message: `Impersonating ${adminUser.email}`,
      data: {
        token,
        user: {
          id: adminUser.id,
          first_name: adminUser.first_name,
          last_name: adminUser.last_name,
          email: adminUser.email,
          role_id: adminUser.role_id,
          role_name: ROLE_NAMES[adminUser.role_id] ?? null,
          role: ROLE_NAMES[adminUser.role_id] ?? "admin",
          organisation_id: adminUser.organisation_id,
          organisation_slug: org.slug,
          status: adminUser.status,
        },
        organisation: {
          id: org.id,
          name: org.name,
          slug: org.slug,
        },
        tenant_urls,
        impersonation: true,
      },
    });
  } catch (err) {
    console.error("impersonateOrganisationAdmin", err);
    return res.status(500).json({
      status: "error",
      message: err?.message || "Failed to impersonate organisation admin",
      data: null,
    });
  }
};

export const createOrganisationAdmin = async (req, res) => {
  try {
    const orgId = parseInt(req.params.id, 10);
    if (Number.isNaN(orgId)) {
      return res.status(400).json({ status: "error", message: "Invalid organisation id", data: null });
    }
    const org = await Organisation.findByPk(orgId);
    if (!org) {
      return res.status(404).json({ status: "error", message: "Organisation not found", data: null });
    }
    if (!org.database_name) {
      return res.status(500).json({
        status: "error",
        message: "Tenant database not provisioned for this organisation",
        data: null,
      });
    }

    const { email, first_name, last_name, country_code, mobile } = req.body;

    if (!email || !first_name || !last_name || !country_code || !mobile) {
      return res.status(400).json({
        status: "error",
        message: "email, first_name, last_name, country_code, and mobile are required",
        data: null,
      });
    }

    const emailNorm = String(email).trim().toLowerCase();
    const existing = await User.findOne({ where: { email: emailNorm } });
    if (existing) {
      return res.status(400).json({
        status: "error",
        message: "Email already registered",
        data: null,
      });
    }

    const plain = generateOrganisationAdminPassword();
    const hashed = await bcrypt.hash(plain, 10);

    const dbName = await resolveOrganisationDatabaseName(org);
    const tenantDb = getTenantDb(dbName);
    const admin = await createUserOnPlatformAndTenant(tenantDb, {
      email: emailNorm,
      first_name: String(first_name).trim(),
      last_name: String(last_name).trim(),
      country_code: String(country_code).trim(),
      mobile: String(mobile).trim(),
      password: hashed,
      role_id: 3,
      organisation_id: orgId,
      is_otp_verified: true,
      is_email_verified: true,
      status: "active",
    });

    let welcomeEmail = { sent: false, reason: "not_attempted" };
    try {
      welcomeEmail = await sendOrganisationAdminWelcomeEmail({
        organisation: org,
        admin,
        plainPassword: plain,
      });
    } catch (mailErr) {
      console.error("createOrganisationAdmin welcome email", mailErr);
      welcomeEmail = { sent: false, reason: mailErr?.message || "send_failed" };
    }

    const tenant_urls = buildTenantFrontendUrls(org.slug);

    return res.status(201).json({
      status: "success",
      message: welcomeEmail.sent
        ? "Organisation admin created. Welcome email sent with login details."
        : "Organisation admin created. Configure EMAIL_USER/EMAIL_PASS to send welcome email.",
      data: {
        user: {
          id: admin.id,
          email: admin.email,
          first_name: admin.first_name,
          last_name: admin.last_name,
          role_id: admin.role_id,
          organisation_id: admin.organisation_id,
        },
        tenant_urls,
        welcome_email: welcomeEmail,
        ...(welcomeEmail.sent ? {} : { temporary_password: plain }),
      },
    });
  } catch (err) {
    console.error("createOrganisationAdmin", err);
    return res.status(500).json({
      status: "error",
      message: err?.message || "Failed to create admin",
      data: null,
    });
  }
};
