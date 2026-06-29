import { Op } from "sequelize";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import platformDb from "../../models/index.js";
import { createImpersonationTicket } from "../../services/impersonationTicket.service.js";
import {
  isPhysicalTenantDatabaseEnabled,
  provisionOrganisationTenantDatabase,
  dropTenantPostgresDatabase,
} from "../../services/tenantDatabaseProvision.service.js";
import { sendOrganisationAdminWelcomeEmail } from "../../services/mail.service.js";
import { mirrorUserToTenant } from "../../services/userSync.service.js";
import { seedTenantOrganisation } from "../../services/tenantSeed.service.js";
import { getTenantDb } from "../../services/tenantDb.service.js";
import { recordPlatformAuditLog, createPlatformNotification } from "../../services/platformActivity.service.js";
import { reactivateOrgManually } from "../../services/orgBilling.service.js";
import { invalidateOrgCache } from "../../services/orgCache.service.js";
import logger from "../../utils/logger.js";
import { getPaginationParams, buildPaginationMeta } from "../../utils/paginate.js";
import { rowsToXlsxBuffer, sendXlsxDownload } from "../../utils/excelExport.util.js";
import { generatePdfBufferFromDefinition } from "../../services/pdfGenerator.service.js";

const Organisation = platformDb.Organisation;
const User = platformDb.User;
const { sequelize } = platformDb;

function slugify(name) {
  const s = String(name || "org")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 90);
  return s || "org";
}

/**
 * Resolve the human-readable plan name to store on the organisation's `plan`
 * string column. Prefers the actual Plan row referenced by plan_id so the Tier
 * shown in the UI always matches the selected plan; falls back to an explicit
 * name string, then "starter".
 */
async function resolvePlanName(planId, fallbackName) {
  if (planId) {
    const parsed = parseInt(planId, 10);
    if (Number.isFinite(parsed)) {
      const plan = await platformDb.Plan.findByPk(parsed, {
        attributes: ["name"],
      });
      if (plan?.name) return plan.name;
    }
  }
  if (fallbackName && String(fallbackName).trim()) {
    return String(fallbackName).trim();
  }
  return "starter";
}

/** True when organisation row is soft-deleted. */
function isOrganisationDeleted(org) {
  return Boolean(org?.deletedAt ?? org?.deleted_at);
}

/**
 * Block registration only for active platform users or users on non-deleted orgs.
 * Removes stale users tied to soft-deleted (or missing) organisations so email/mobile can be reused.
 */
async function resolveRegistrationConflicts({ email, country_code, mobile }) {
  const emailNorm = String(email).trim().toLowerCase();
  const mobileNorm = String(mobile).trim().replace(/\s/g, "");
  const countryCodeNorm = String(country_code).trim();

  const orgInclude = {
    model: Organisation,
    as: "organisation",
    required: false,
    paranoid: false,
  };

  const emailUser = await User.findOne({
    where: { email: emailNorm },
    include: [orgInclude],
    paranoid: false,
  });
  if (emailUser) {
    const org = emailUser.organisation;
    const deleted = Boolean(emailUser.deletedAt ?? emailUser.deleted_at);
    const stale =
      deleted || (emailUser.organisation_id != null && (!org || isOrganisationDeleted(org)));
    if (!stale && (!emailUser.organisation_id || (org && !isOrganisationDeleted(org)))) {
      return {
        field: "email",
        message: `Email ${emailNorm} is already registered. Use a different email address.`,
      };
    }
    if (stale) await emailUser.destroy({ force: true });
  }

  // idx_users_mobile_unique has no WHERE deleted_at IS NULL, so soft-deleted rows still
  // occupy the index slot. Must use paranoid: false here to catch and hard-delete them
  // before attempting the insert, otherwise the DB throws a SequelizeUniqueConstraintError.
  const mobileUser = await User.findOne({
    where: { country_code: countryCodeNorm, mobile: mobileNorm },
    include: [orgInclude],
    paranoid: false,
  });
  if (mobileUser) {
    const org = mobileUser.organisation;
    const deleted = Boolean(mobileUser.deletedAt ?? mobileUser.deleted_at);
    const stale =
      deleted || (mobileUser.organisation_id != null && (!org || isOrganisationDeleted(org)));
    if (!stale && (!mobileUser.organisation_id || (org && !isOrganisationDeleted(org)))) {
      return {
        field: "mobile",
        message: `Mobile number ${countryCodeNorm} ${mobileNorm} is already registered. Use a different mobile number.`,
      };
    }
    if (stale) await mobileUser.destroy({ force: true });
  }

  return null;
}

async function removeOrganisationUsers(orgId) {
  await User.destroy({ where: { organisation_id: orgId }, force: true });
}

export const listOrganisations = async (req, res) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { count, rows } = await Organisation.findAndCountAll({
      order: [["id", "ASC"]],
      include: [
        {
          model: User,
          as: "users",
          attributes: ["id", "email", "role_id", "status"],
          required: false,
        },
      ],
      limit,
      offset,
      // hasMany "users" join would multiply rows; distinct counts organisations only.
      distinct: true,
    });
    return res.status(200).json({
      status: "success",
      message: "Organisations retrieved",
      data: { organisations: rows },
      pagination: buildPaginationMeta(count, page, limit),
    });
  } catch (err) {
    logger.error({ err }, "listOrganisations");
    return res.status(500).json({
      status: "error",
      message: "Failed to list organisations",
      data: null,
    });
  }
};

// ── Exports (Excel / PDF) ────────────────────────────────────────────────────

// Fetch every organisation (no pagination) with the plan + users needed so the
// export rows mirror exactly what the table shows.
async function fetchAllOrganisationsForExport() {
  return Organisation.findAll({
    order: [["id", "ASC"]],
    include: [
      {
        model: User,
        as: "users",
        attributes: ["id"],
        required: false,
      },
      {
        model: platformDb.Plan,
        as: "plan",
        attributes: ["id", "name"],
        required: false,
      },
    ],
  });
}

const ORG_EXPORT_COLUMNS = [
  { key: "name", header: "Organisation" },
  { key: "slug", header: "Slug" },
  { key: "email", header: "Primary Email" },
  { key: "country", header: "Country" },
  { key: "tier", header: "Tier" },
  { key: "users", header: "Users" },
  { key: "status", header: "Status" },
];

const titleCase = (s) =>
  typeof s === "string" && s
    ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
    : "—";

function organisationToExportRow(org) {
  // `plan` may be the joined Plan object (when associated) or the raw string col.
  const planName =
    (org.plan && typeof org.plan === "object" ? org.plan.name : org.plan) || "—";
  return {
    name: org.name || "—",
    slug: org.slug || "—",
    email: org.primaryEmail || "—",
    country: org.country || "—",
    tier: titleCase(planName),
    users: Array.isArray(org.users) ? org.users.length : 0,
    status: titleCase(org.status || "trial"),
  };
}

export const exportOrganisationsExcel = async (req, res) => {
  try {
    const orgs = await fetchAllOrganisationsForExport();
    const rows = orgs.map(organisationToExportRow);
    const buffer = rowsToXlsxBuffer(rows, ORG_EXPORT_COLUMNS);
    return sendXlsxDownload(
      res,
      buffer,
      `organisations_${new Date().toISOString().split("T")[0]}.xlsx`,
    );
  } catch (err) {
    logger.error({ err }, "exportOrganisationsExcel");
    return res.status(500).json({
      status: "error",
      message: "Failed to export organisations",
      data: null,
    });
  }
};

export const exportOrganisationsPdf = async (req, res) => {
  try {
    const orgs = await fetchAllOrganisationsForExport();
    const rows = orgs.map(organisationToExportRow);

    const headerCells = ORG_EXPORT_COLUMNS.map((c) => ({
      text: c.header,
      style: "th",
    }));
    const bodyRows = rows.map((row) =>
      ORG_EXPORT_COLUMNS.map((c) => ({
        text: String(row[c.key] ?? ""),
        style: "td",
      })),
    );

    const generatedAt = new Date().toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    const docDefinition = {
      pageSize: "A4",
      pageOrientation: "landscape",
      pageMargins: [32, 40, 32, 44],
      content: [
        { text: "Organisations", style: "title" },
        {
          text: `Client organisations, plans and access — ${rows.length} record${rows.length === 1 ? "" : "s"}`,
          style: "subtitle",
          margin: [0, 2, 0, 2],
        },
        { text: `Generated: ${generatedAt}`, style: "meta", margin: [0, 0, 0, 14] },
        rows.length
          ? {
              table: {
                headerRows: 1,
                widths: ["*", "auto", "*", "auto", "auto", "auto", "auto"],
                body: [headerCells, ...bodyRows],
              },
              layout: {
                hLineWidth: (i, node) =>
                  i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.5,
                vLineWidth: () => 0,
                hLineColor: (i) => (i <= 1 ? "#1d4ed8" : "#e2e8f0"),
                fillColor: (rowIndex) =>
                  rowIndex === 0
                    ? "#1d4ed8"
                    : rowIndex % 2 === 0
                      ? "#f8fafc"
                      : null,
                paddingLeft: () => 7,
                paddingRight: () => 7,
                paddingTop: () => 6,
                paddingBottom: () => 6,
              },
            }
          : {
              text: "No organisations found.",
              style: "td",
              margin: [0, 20, 0, 0],
            },
      ],
      footer: (currentPage, pageCount) => ({
        margin: [32, 4, 32, 0],
        columns: [
          {
            text: "EPiC CRM — Organisations Export",
            style: "footer",
            width: "*",
          },
          {
            text: `Page ${currentPage} of ${pageCount}`,
            style: "footer",
            alignment: "right",
            width: "auto",
          },
        ],
      }),
      styles: {
        title: { fontSize: 17, bold: true, color: "#1e3a5f" },
        subtitle: { fontSize: 10, color: "#475569" },
        meta: { fontSize: 8, color: "#64748b" },
        th: { fontSize: 9, bold: true, color: "#ffffff" },
        td: { fontSize: 9, color: "#1e293b" },
        footer: { fontSize: 8, color: "#64748b" },
      },
      defaultStyle: { fontSize: 9, color: "#334155" },
    };

    const buffer = await generatePdfBufferFromDefinition(docDefinition);
    const filename = `organisations_${new Date().toISOString().split("T")[0]}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(buffer);
  } catch (err) {
    logger.error({ err }, "exportOrganisationsPdf");
    if (!res.headersSent) {
      return res.status(500).json({
        status: "error",
        message: "Failed to export organisations",
        data: null,
      });
    }
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
    logger.error({ err }, "getOrganisationById");
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
    // Lightweight input validation (this is a superadmin-only route, but malformed
    // input should still be rejected before it reaches the DB / tenant provisioning).
    const emailNorm = String(primaryEmail).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
      return res.status(400).json({
        status: "error",
        message: "primaryEmail is not a valid email address",
        data: null,
      });
    }
    if (String(name).trim().length > 200) {
      return res.status(400).json({
        status: "error",
        message: "name is too long (maximum 200 characters)",
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

    // Read platform trial settings (default: trial enabled, 14 days)
    const [trialEnabledRow, trialDaysRow] = await Promise.all([
      platformDb.PlatformSetting.findOne({ where: { key: "free_trial_enabled" } }),
      platformDb.PlatformSetting.findOne({ where: { key: "free_trial_days" } }),
    ]);
    const freeTrialEnabled = trialEnabledRow ? trialEnabledRow.value !== "false" : true;
    const freeTrialDays = trialDaysRow ? (parseInt(trialDaysRow.value, 10) || 14) : 14;

    const planName = await resolvePlanName(plan_id, plan);

    let org;
    try {
      org = await Organisation.create({
        name: String(name).trim(),
        slug: finalSlug,
        plan: planName,
        plan_id: plan_id ? parseInt(plan_id, 10) : null,
        // Trial ON → trial (unless an explicit status was passed). Trial OFF →
        // active so a newly created/paid org can sign in immediately instead of
        // being parked in "suspended".
        status: freeTrialEnabled ? (status || "trial") : (status || "active"),
        primaryEmail: String(primaryEmail).trim().toLowerCase(),
        country: country || null,
        database_name: databaseName,
      });

      // Provision subscription: trial if enabled, otherwise mark as expired
      // so the admin is directed to pay on first login.
      const now = new Date();
      if (freeTrialEnabled) {
        const trialEndsAt = new Date(now);
        trialEndsAt.setDate(trialEndsAt.getDate() + freeTrialDays);
        await platformDb.Subscription.create({
          organisation_id: org.id,
          plan_id: org.plan_id || null,
          status: "trial",
          current_period_start: now,
          current_period_end: trialEndsAt,
          trial_ends_at: trialEndsAt,
        });
      } else {
        await platformDb.Subscription.create({
          organisation_id: org.id,
          plan_id: org.plan_id || null,
          status: "expired",
          current_period_start: now,
          current_period_end: now,
          trial_ends_at: null,
        });
      }
    } catch (err) {
      if (physicalEnabled && databaseName) {
        try {
          await dropTenantPostgresDatabase(databaseName);
        } catch (_) {
        }
      }
    }

    await recordPlatformAuditLog({
      category: "Organisation",
      action: "Organisation Created",
      user: req.user?.email || "superadmin@epic.com",
      org: org.name,
      description: `Successfully created organisation ${org.name} (${org.slug}). Physical DB: ${physicalEnabled ? databaseName : "shared"}`,
      status: "Success"
    });

    await createPlatformNotification({
      title: "New Organisation Registered",
      desc: `Organisation ${org.name} has signed up on the ${org.plan || 'starter'} plan.`,
      type: "success"
    });

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
    logger.error({ err }, "createOrganisation");
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

/**
 * Atomic create: validates admin email/mobile first, then org + subscription + admin in one transaction.
 * Rolls back org (and tenant DB) if any step fails — no orphan organisations.
 */
export const createOrganisationWithAdmin = async (req, res) => {
  const physicalEnabled = isPhysicalTenantDatabaseEnabled();
  let databaseName = null;
  let provisionMeta = null;
  let org = null;

  try {
    const {
      name,
      slug,
      plan,
      plan_id,
      status,
      primaryEmail,
      country,
      adminEmail,
      adminFirstName,
      adminLastName,
      adminCountryCode,
      adminMobile,
      password,
    } = req.body;

    const adminEmailVal = String(adminEmail || "").trim().toLowerCase();
    const adminFirst = String(adminFirstName || "").trim();
    const adminLast = String(adminLastName || "").trim();
    const adminCc = String(adminCountryCode || "+44").trim();
    const adminMobileVal = String(adminMobile || "").replace(/\s/g, "") || "0000000001";

    if (!name || !primaryEmail) {
      return res.status(400).json({
        status: "error",
        message: "name and primaryEmail are required",
        data: null,
      });
    }
    if (!adminEmailVal || !adminFirst || !adminLast || !adminCc || !adminMobileVal) {
      return res.status(400).json({
        status: "error",
        message: "Administrator email, name, country code, and mobile are required",
        data: null,
      });
    }

    const registrationConflict = await resolveRegistrationConflicts({
      email: adminEmailVal,
      country_code: adminCc,
      mobile: adminMobileVal,
    });
    if (registrationConflict) {
      return res.status(400).json({
        status: "error",
        message: registrationConflict.message,
        data: null,
      });
    }

    let finalSlug = slug ? String(slug).trim().toLowerCase() : slugify(name);
    const exists = await Organisation.findOne({ where: { slug: finalSlug } });
    if (exists) {
      finalSlug = `${finalSlug}-${Date.now().toString(36)}`;
    }

    if (physicalEnabled) {
      provisionMeta = await provisionOrganisationTenantDatabase(finalSlug);
      databaseName = provisionMeta.databaseName;
    }

    // Read platform trial settings (default: trial enabled, 14 days)
    const [trialEnabledRow, trialDaysRow] = await Promise.all([
      platformDb.PlatformSetting.findOne({ where: { key: "free_trial_enabled" } }),
      platformDb.PlatformSetting.findOne({ where: { key: "free_trial_days" } }),
    ]);
    const freeTrialEnabled = trialEnabledRow ? trialEnabledRow.value !== "false" : true;
    const freeTrialDays = trialDaysRow ? (parseInt(trialDaysRow.value, 10) || 14) : 14;

    const plain =
      password && String(password).length >= 8
        ? String(password)
        : `T-${randomBytes(12).toString('base64url')}`; // S-09 fix: CSPRNG temp password
    const hashed = await bcrypt.hash(plain, 12); // S-29 fix: uniform cost factor

    const planName = await resolvePlanName(plan_id, plan);

    await sequelize.transaction(async (transaction) => {
      org = await Organisation.create(
        {
          name: String(name).trim(),
          slug: finalSlug,
          plan: planName,
          plan_id: plan_id ? parseInt(plan_id, 10) : null,
          // Trial ON → trial. Trial OFF → active so the new org can sign in
          // immediately (billing guard still redirects to pay via the expired
          // subscription) rather than being parked in "suspended".
          status: freeTrialEnabled ? (status || "trial") : (status || "active"),
          primaryEmail: String(primaryEmail).trim().toLowerCase(),
          country: country || null,
          database_name: databaseName,
        },
        { transaction },
      );

      const now = new Date();
      if (freeTrialEnabled) {
        const trialEndsAt = new Date(now);
        trialEndsAt.setDate(trialEndsAt.getDate() + freeTrialDays);
        await platformDb.Subscription.create(
          {
            organisation_id: org.id,
            plan_id: org.plan_id || null,
            status: "trial",
            current_period_start: now,
            current_period_end: trialEndsAt,
            trial_ends_at: trialEndsAt,
          },
          { transaction },
        );
      } else {
        await platformDb.Subscription.create(
          {
            organisation_id: org.id,
            plan_id: org.plan_id || null,
            status: "expired",
            current_period_start: now,
            current_period_end: now,
            trial_ends_at: null,
          },
          { transaction },
        );
      }

      await User.create(
        {
          email: adminEmailVal,
          first_name: adminFirst,
          last_name: adminLast,
          country_code: adminCc,
          mobile: adminMobileVal,
          password: hashed,
          role_id: 3,
          organisation_id: org.id,
          temp_password: 'pending_reset',
          is_otp_verified: true,
          is_email_verified: true,
          status: "active",
        },
        { transaction },
      );
    });

    const admin = await User.findOne({
      where: { organisation_id: org.id, role_id: 3 },
      order: [["id", "DESC"]],
    });

    if (admin && physicalEnabled && databaseName) {
      try {
        const tenantDb = getTenantDb(databaseName);
        await seedTenantOrganisation(tenantDb, org);
        await mirrorUserToTenant(tenantDb, admin);
        logger.info({ databaseName }, "Admin and Organisation mirrored to tenant DB");
      } catch (mirrorErr) {
        logger.error({ err: mirrorErr, databaseName }, "Failed to mirror admin to tenant DB");
      }
    }

    let mailResult = { sent: false, reason: "not_attempted" };
    if (admin) {
      try {
        mailResult = await sendOrganisationAdminWelcomeEmail({
          admin,
          plainPassword: plain,
          organisationId: org.id,
        });
        if (mailResult.sent) {
          logger.info(
            { adminEmail: admin.email, deliveryRecipient: mailResult.deliveryRecipient, usedSource: mailResult.usedSource },
            "Welcome email sent to admin",
          );
        } else {
          logger.warn(
            { adminEmail: admin.email, reason: mailResult.reason, error: mailResult.error },
            "Welcome email not sent to admin",
          );
        }
      } catch (mailErr) {
        logger.error({ err: mailErr }, "Welcome email failed");
        mailResult = { sent: false, reason: "send_failed", error: mailErr?.message };
      }
    }

    const message = mailResult.sent
      ? "Organisation and admin created. Welcome email sent."
      : mailResult.ownerNotified
        ? "Organisation and admin created. Welcome email failed; SMTP owner was notified."
        : "Organisation and admin created.";

    await recordPlatformAuditLog({
      category: "Organisation",
      action: "Organisation Created",
      user: req.user?.email || "superadmin@epic.com",
      org: org.name,
      description: `Successfully created organisation ${org.name} with administrator ${adminEmailVal}. Physical DB: ${physicalEnabled ? databaseName : "shared"}`,
      status: "Success"
    });

    await createPlatformNotification({
      title: "New Tenant Registered",
      desc: `Organisation ${org.name} has signed up on the ${org.plan || 'starter'} plan with administrator ${adminEmailVal}.`,
      type: "success"
    });

    return res.status(201).json({
      status: "success",
      message,
      data: {
        organisation: org,
        user: admin
          ? {
              id: admin.id,
              email: admin.email,
              first_name: admin.first_name,
              last_name: admin.last_name,
              role_id: admin.role_id,
              organisation_id: admin.organisation_id,
            }
          : null,
        // Only surface the generated password as a fallback when the credential
        // email could NOT be delivered. On success it is delivered by email only
        // and never echoed in the API response (avoids plaintext-credential leak).
        ...(!password && !mailResult.sent ? { temporary_password: plain } : {}),
        email_sent: Boolean(mailResult.sent),
        email_error: mailResult.sent ? null : mailResult.error || mailResult.reason,
        mail_source: mailResult.usedSource || null,
        delivery_recipient: mailResult.deliveryRecipient || admin?.email || null,
        owner_notified: Boolean(mailResult.ownerNotified),
        ...(physicalEnabled && databaseName
          ? {
              tenant_database: databaseName,
              database_created: provisionMeta?.created ?? false,
            }
          : {}),
      },
    });
  } catch (err) {
    logger.error({ err }, "createOrganisationWithAdmin");

    if (org?.id) {
      try {
        await removeOrganisationUsers(org.id);
        await org.destroy({ force: true });
      } catch (rollbackErr) {
        logger.error({ err: rollbackErr }, "Rollback organisation failed");
      }
    }
    if (physicalEnabled && databaseName) {
      try {
        await dropTenantPostgresDatabase(databaseName);
      } catch (_) {
        /* ignore */
      }
    }

    if (err.name === "SequelizeUniqueConstraintError") {
      const fields = Object.keys(err.fields || {});
      const constraint = String(err.parent?.constraint || err.message || '').toLowerCase();
      const isSlug = fields.includes('slug') || constraint.includes('slug');
      const isMobile = fields.includes('mobile') || constraint.includes('mobile');
      const message = isSlug
        ? "An organisation with this subdomain already exists. Try a different subdomain."
        : isMobile
          ? "This mobile number is already registered. Use a different mobile."
          : "Email or mobile is already registered. Use different admin details.";
      return res.status(400).json({ status: "error", message, data: null });
    }

    const msg = err?.message || "Failed to create organisation with admin";
    const permissionDenied =
      /permission denied|must be owner|createdb|insufficient privilege/i.test(msg);
    return res.status(permissionDenied ? 503 : 500).json({
      status: "error",
      message: msg,
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
    const { name, slug, plan, plan_id, status, primaryEmail, country } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (slug !== undefined) updates.slug = String(slug).trim().toLowerCase();
    if (plan_id !== undefined) {
      const parsedPlanId = parseInt(plan_id, 10);
      updates.plan_id = Number.isFinite(parsedPlanId) ? parsedPlanId : null;
      // Keep the `plan` name string in sync with the chosen plan so the Tier
      // column reflects the real plan, not a stale/hardcoded value.
      updates.plan = await resolvePlanName(updates.plan_id, plan);
    } else if (plan !== undefined) {
      updates.plan = plan;
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
    await org.update(updates);

    // Status changes must clear the cached org status so the auth middleware
    // sees them immediately (otherwise stale for up to the cache TTL). Setting a
    // status of "active" also reactivates/extends the subscription, so an expired
    // sub doesn't keep the org blocked.
    if (updates.status === "active") {
      await reactivateOrgManually(id);
    } else if (updates.status !== undefined) {
      invalidateOrgCache(id);
    }

    if (updates.name !== undefined && org.slug) {
      try {
        const tenantDb = await getTenantDb(org.slug);
        if (tenantDb && tenantDb.Organisation) {
          await tenantDb.Organisation.update(
            { name: updates.name },
            { where: { id: org.id } }
          );
        }
      } catch (syncErr) {
        logger.error({ err: syncErr }, "Failed to sync organisation name to tenant DB");
      }
    }

    await recordPlatformAuditLog({
      category: "Organisation",
      action: "Organisation Updated",
      user: req.user?.email || "superadmin@epic.com",
      org: org.name,
      description: `Updated properties on organisation ${org.name} (${org.slug}). Updates: ${Object.keys(updates).join(", ")}`,
      status: "Success"
    });

    return res.status(200).json({
      status: "success",
      message: "Organisation updated",
      data: { organisation: org },
    });
  } catch (err) {
    logger.error({ err }, "updateOrganisation");
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

    await removeOrganisationUsers(id);
    await org.destroy();

    await recordPlatformAuditLog({
      category: "Organisation",
      action: "Organisation Deleted",
      user: req.user?.email || "superadmin@epic.com",
      org: org.name,
      description: `Soft-deleted organisation ${org.name} (${org.slug}) and removed administrators.`,
      status: "Success"
    });

    await createPlatformNotification({
      title: "Organisation Deleted",
      desc: `Organisation ${org.name} has been manually deleted by platform staff.`,
      type: "warning"
    });

    return res.status(200).json({
      status: "success",
      message: "Organisation deleted (soft delete). Admin accounts removed so email/mobile can be reused.",
      data: null,
    });
  } catch (err) {
    logger.error({ err }, "deleteOrganisation");
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
    invalidateOrgCache(id);

    await recordPlatformAuditLog({
      category: "Organisation",
      action: "Organisation Suspended",
      user: req.user?.email || "superadmin@epic.com",
      org: org.name,
      description: `Manually suspended organisation ${org.name} (${org.slug}).`,
      status: "Success"
    });

    await createPlatformNotification({
      title: "Organisation Suspended",
      desc: `Organisation ${org.name} has been suspended by platform staff.`,
      type: "warning"
    });

    return res.status(200).json({
      status: "success",
      message: "Organisation suspended",
      data: { organisation: org },
    });
  } catch (err) {
    logger.error({ err }, "suspendOrganisation");
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

    // Full reactivation: flip the org active AND reactivate/extend the latest
    // subscription, then clear the org cache so it takes effect immediately.
    // (Activating the org alone leaves an expired subscription that the auth
    // middleware would still block on, and the cache would mask it for ~5 min.)
    await reactivateOrgManually(id);
    await org.reload();

    await recordPlatformAuditLog({
      category: "Organisation",
      action: "Organisation Activated",
      user: req.user?.email || "superadmin@epic.com",
      org: org.name,
      description: `Manually activated organisation ${org.name} (${org.slug}) and reactivated its subscription.`,
      status: "Success"
    });

    await createPlatformNotification({
      title: "Organisation Activated",
      desc: `Organisation ${org.name} has been activated by platform staff.`,
      type: "success"
    });

    return res.status(200).json({
      status: "success",
      message: "Organisation activated",
      data: { organisation: org },
    });
  } catch (err) {
    logger.error({ err }, "activateOrganisation");
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

    const registrationConflict = await resolveRegistrationConflicts({
      email: emailNorm,
      country_code: countryCodeNorm,
      mobile: mobileNorm,
    });
    if (registrationConflict) {
      return res.status(400).json({
        status: "error",
        message: registrationConflict.message,
        data: null,
      });
    }

    const plain =
      password && String(password).length >= 8
        ? String(password)
        : `T-${randomBytes(12).toString('base64url')}`; // S-09 fix: CSPRNG temp password
    const hashed = await bcrypt.hash(plain, 12); // S-29 fix: uniform cost factor

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

    const loginUrl =
      process.env.FRONTEND_URL ||
      process.env.CLIENT_URL ||
      "http://localhost:5173";

    let mailResult = { sent: false, reason: "not_attempted" };

    try {
      mailResult = await sendOrganisationAdminWelcomeEmail({
        admin,
        plainPassword: plain,
        organisationId: orgId,
        loginUrl,
      });
      if (mailResult.sent) {
        logger.info(
          { adminEmail: admin.email, usedSource: mailResult.usedSource },
          "Welcome credentials sent to admin",
        );
      } else {
        logger.warn(
          { adminEmail: admin.email, reason: mailResult.reason, error: mailResult.error },
          "Welcome email not sent to admin",
        );
      }
    } catch (mailErr) {
      logger.error({ err: mailErr }, "Failed to send welcome email to new admin");
      mailResult = {
        sent: false,
        reason: "send_failed",
        error: mailErr?.message || "Email delivery failed",
      };
    }

    const message = mailResult.sent
      ? "Organisation admin created. Welcome email sent."
      : mailResult.ownerNotified
        ? "Organisation admin created. Welcome email could not be delivered; a failure notice was sent to your SMTP account."
        : "Organisation admin created. Welcome email could not be sent — check Superadmin Connectivity SMTP or .env EMAIL_USER/EMAIL_PASS.";

    return res.status(201).json({
      status: "success",
      message,
      data: {
        user: {
          id: admin.id,
          email: admin.email,
          first_name: admin.first_name,
          last_name: admin.last_name,
          role_id: admin.role_id,
          organisation_id: admin.organisation_id,
        },
        // Only surface the generated password as a fallback when the credential
        // email could NOT be delivered (otherwise email-only delivery).
        ...(!password && !mailResult.sent ? { temporary_password: plain } : {}),
        email_sent: Boolean(mailResult.sent),
        email_error: mailResult.sent
          ? null
          : mailResult.error || mailResult.reason || "mail_not_configured",
        mail_source: mailResult.usedSource || null,
        owner_notified: Boolean(mailResult.ownerNotified),
      },
    });
  } catch (err) {
    logger.error({ err }, "createOrganisationAdmin");

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

    // Issue a single-use ticket instead of the raw JWT. The JWT is minted
    // server-side only when the ticket is redeemed at /api/auth/handoff, so it
    // never travels in the handoff URL or through the browser.
    const ticket = createImpersonationTicket({
      id: admin.id,
      email: admin.email,
      role_id: admin.role_id,
      organisation_id: admin.organisation_id,
    });

    // S-15 fix: every impersonation must be traceable. Record who impersonated
    // which org admin and from which IP so the event survives even if the
    // impersonation token is later revoked or expires without being used.
    recordPlatformAuditLog({
      category: 'Authentication',
      action: 'Login As Organisation Admin',
      user: req.user?.email || 'superadmin@epic.com',
      org: org.name,
      description: `Impersonated organisation admin ${admin.email} of ${org.name}`,
      status: 'Success',
      user_id: req.user?.userId ?? req.user?.id ?? null,
      details: JSON.stringify({
        actorId: req.user?.userId ?? req.user?.id,
        targetOrgId: orgId,
        targetOrgSlug: org.slug,
        targetAdminId: admin.id,
        targetAdminEmail: admin.email,
      }),
      ip_address: req.ip || req.socket?.remoteAddress || null,
    });

    return res.status(200).json({
      status: "success",
      message: "Impersonation ticket generated",
      data: {
        ticket,
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
    logger.error({ err }, "impersonateOrganisationAdmin");
    return res.status(500).json({
      status: "error",
      message: err?.message || "Failed to impersonate admin",
      data: null,
    });
  }
};
