import { Op } from "sequelize";
import bcrypt from "bcryptjs";
import db from "../models/index.js";
import {
  isPhysicalTenantDatabaseEnabled,
  provisionOrganisationTenantDatabase,
  dropTenantPostgresDatabase,
} from "../services/tenantDatabaseProvision.service.js";
const Organisation = db.Organisation;
const User = db.User;

function slugify(name) {
  const s = String(name || "org")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 90);
  return s || "org";
}

export const listOrganisations = async (req, res) => {
  try {
    const rows = await Organisation.findAll({
      order: [["id", "ASC"]],
      include: [
        {
          model: User,
          as: "users",
          attributes: ["id", "email", "role_id", "status"],
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

export const createOrganisation = async (req, res) => {
  try {
    const { name, slug, plan, status, primaryEmail, country } = req.body;
    if (!name || !primaryEmail) {
      return res.status(400).json({
        status: "error",
        message: "name and primaryEmail are required",
        data: null,
      });
    }
    let finalSlug = slug ? String(slug).trim().toLowerCase() : slugify(name);
    const exists = await Organisation.findOne({ where: { slug: finalSlug } });
    if (exists) {
      finalSlug = `${finalSlug}-${Date.now().toString(36)}`;
    }
    const physicalEnabled = isPhysicalTenantDatabaseEnabled();
    let databaseName = null;
    let provisionMeta = null;

    if (physicalEnabled) {
      provisionMeta = await provisionOrganisationTenantDatabase(finalSlug);
      databaseName = provisionMeta.databaseName;
    }

    let org;
    try {
      org = await Organisation.create({
        name: String(name).trim(),
        slug: finalSlug,
        plan: plan || "starter",
        status: status || "trial",
        primaryEmail: String(primaryEmail).trim().toLowerCase(),
        country: country || null,
        database_name: databaseName,
      });
    } catch (err) {
      if (physicalEnabled && databaseName) {
        try {
          await dropTenantPostgresDatabase(databaseName);
        } catch (_) {
          /* ignore rollback errors */
        }
      }
      throw err;
    }

    return res.status(201).json({
      status: "success",
      message: physicalEnabled
        ? "Organisation created with dedicated PostgreSQL database (schema synced)."
        : "Organisation created (shared database; physical tenants disabled).",
      data: {
        organisation: org,
        ...(physicalEnabled && databaseName
          ? {
              tenant_database: databaseName,
              database_created: provisionMeta?.created ?? false,
            }
          : {}),
      },
    });
  } catch (err) {
    console.error("createOrganisation", err);
    const msg = err?.message || "Failed to create organisation";
    const permissionDenied =
      /permission denied|must be owner|createdb|insufficient privilege/i.test(msg);
    return res.status(permissionDenied ? 503 : 500).json({
      status: "error",
      message: permissionDenied
        ? "Could not create tenant database. Grant CREATEDB to DB_USER or set TENANT_DB_CREATOR_USER with superuser rights."
        : msg,
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
    const { name, slug, plan, status, primaryEmail, country } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (slug !== undefined) updates.slug = String(slug).trim().toLowerCase();
    if (plan !== undefined) updates.plan = plan;
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
    await org.update(updates);
    return res.status(200).json({
      status: "success",
      message: "Organisation updated",
      data: { organisation: org },
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

/**
 * Create the first org admin for a tenant (superadmin only).
 */
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

    const {
      email,
      first_name,
      last_name,
      country_code,
      mobile,
      password,
    } = req.body;

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

    const plain =
      password && String(password).length >= 8
        ? String(password)
        : `Temp-${Math.random().toString(36).slice(2, 10)}!1Aa`;
    const hashed = await bcrypt.hash(plain, 10);

    const admin = await User.create({
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

    return res.status(201).json({
      status: "success",
      message: "Organisation admin created",
      data: {
        user: {
          id: admin.id,
          email: admin.email,
          first_name: admin.first_name,
          last_name: admin.last_name,
          role_id: admin.role_id,
          organisation_id: admin.organisation_id,
        },
        ...(password ? {} : { temporary_password: plain }),
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
