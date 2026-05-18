import { Op } from "sequelize";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import platformDb from "../../models/index.js";
import {
  isPhysicalTenantDatabaseEnabled,
  provisionOrganisationTenantDatabase,
  dropTenantPostgresDatabase,
} from "../../services/tenantDatabaseProvision.service.js";

const Organisation = platformDb.Organisation;
const User = platformDb.User;

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
          attributes: ["id", "email", "role_id", "status"],
          required: false,
        },
        {
          model: platformDb.Plan,
          as: "plan",
          attributes: ["id", "name", "price", "billing_cycle"],
          required: false,
        },
        {
          model: platformDb.Subscription,
          as: "subscriptions",
          attributes: ["id", "status", "current_period_end"],
          required: false,
        },
      ],
    });
    if (!org) {
      return res.status(404).json({ status: "error", message: "Organisation not found", data: null });
    }
    return res.status(200).json({
      status: "success",
      message: "Organisation retrieved",
      data: { organisation: org },
    });
  } catch (err) {
    console.error("getOrganisationById", err);
    return res.status(500).json({
      status: "error",
      message: err?.message || "Failed to retrieve organisation",
      data: null,
    });
  }
};

export const createOrganisation = async (req, res) => {
  try {
    const { name, slug, plan, plan_id, status, primaryEmail, country } = req.body;
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
        plan_id: plan_id ? parseInt(plan_id, 10) : null,
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

    if (org.database_name) {
      try {
        await dropTenantPostgresDatabase(org.database_name);
      } catch (err) {
        console.error("Failed to drop tenant database:", err);
      }
    }

    await org.destroy();

    return res.status(200).json({
      status: "success",
      message: "Organisation deleted",
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

    return res.status(200).json({
      status: "success",
      message: "Organisation suspended",
      data: { organisation: org },
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

    await org.update({ status: "active" });

    return res.status(200).json({
      status: "success",
      message: "Organisation activated",
      data: { organisation: org },
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
    const mobileNorm = String(mobile).trim().replace(/\s/g, "");
    const countryCodeNorm = String(country_code).trim();

    const existingEmail = await User.findOne({ where: { email: emailNorm } });
    if (existingEmail) {
      return res.status(400).json({
        status: "error",
        message: `Email ${emailNorm} is already registered. Use a different email address.`,
        data: null,
      });
    }

    const existingMobile = await User.findOne({ where: { country_code: countryCodeNorm, mobile: mobileNorm } });
    if (existingMobile) {
      return res.status(400).json({
        status: "error",
        message: `Mobile number ${countryCodeNorm} ${mobileNorm} is already registered. Use a different mobile number.`,
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
      country_code: countryCodeNorm,
      mobile: mobileNorm,
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

    if (err.name === "SequelizeUniqueConstraintError") {
      const fields = err.fields || {};
      if (fields.email || String(err.message).toLowerCase().includes("email")) {
        return res.status(400).json({
          status: "error",
          message: "Email is already registered. Use a different email address.",
          data: null,
        });
      }
      if (fields.mobile || fields.country_code) {
        return res.status(400).json({
          status: "error",
          message: "Mobile number is already registered. Use a different mobile number.",
          data: null,
        });
      }
      return res.status(400).json({
        status: "error",
        message: "A user with these details already exists.",
        data: null,
      });
    }

    return res.status(500).json({
      status: "error",
      message: err?.message || "Failed to create admin",
      data: null,
    });
  }
};

export const impersonateOrganisationAdmin = async (req, res) => {
  try {
    const orgId = parseInt(req.params.id, 10);
    if (Number.isNaN(orgId)) {
      return res.status(400).json({ status: "error", message: "Invalid organisation id", data: null });
    }

    const org = await Organisation.findByPk(orgId);
    if (!org) {
      return res.status(404).json({ status: "error", message: "Organisation not found", data: null });
    }

    const admin = await User.findOne({
      where: {
        organisation_id: orgId,
        role_id: 3,
        status: "active",
      },
      order: [["id", "ASC"]],
    });

    if (!admin) {
      return res.status(404).json({
        status: "error",
        message: "No active admin found for this organisation",
        data: null,
      });
    }

    const token = jwt.sign(
      {
        id: admin.id,
        email: admin.email,
        role_id: admin.role_id,
        organisation_id: admin.organisation_id,
      },
      process.env.JWT_SECRET || "epic-secret-key",
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      status: "success",
      message: "Impersonation token generated",
      data: {
        token,
        user: {
          id: admin.id,
          email: admin.email,
          first_name: admin.first_name,
          last_name: admin.last_name,
          role_id: admin.role_id,
          organisation_id: admin.organisation_id,
        },
        organisation: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          status: org.status,
        },
      },
    });
  } catch (err) {
    console.error("impersonateOrganisationAdmin", err);
    return res.status(500).json({
      status: "error",
      message: err?.message || "Failed to impersonate admin",
      data: null,
    });
  }
};
