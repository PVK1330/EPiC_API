import { Op, UniqueConstraintError } from "sequelize";
import logger from "../utils/logger.js";
import { computeFee } from "./licenceFee.service.js";
import { validateTransition, WORKFLOW_TYPES } from "./workflowEngine.service.js";


/**
 * Orchestration for the normalized Sponsor Licence Application V2 (8-step wizard).
 *
 * The parent row stays in `licence_applications` (application_version = 2) so the
 * existing review / audit / activation pipeline is reused; the structured section
 * and child data live in the dedicated V2 tables.
 */

export const APPLICATION_VERSION_V2 = 2;

export const ROUTE_CODES = Object.freeze(["SkilledWorker", "Student", "ScaleUp", "GBM", "GAE"]);

export const ROUTE_LABELS = Object.freeze({
  SkilledWorker: "Skilled Worker",
  Student: "Student",
  ScaleUp: "Scale-up",
  GBM: "Global Business Mobility",
  GAE: "Government Authorised Exchange",
});

// Appendix A document checklist seeded per application. `base` is always required;
// route-specific entries are added when that route is selected.
const APPENDIX_BASE = [
  { key: "employer_liability_insurance", name: "Employer's liability insurance certificate (min £5m)" },
  { key: "proof_of_registration", name: "Certificate of incorporation / proof of business registration" },
  { key: "paye_hmrc_registration", name: "PAYE / HMRC registration evidence" },
  { key: "business_bank_statement", name: "Business bank account statement" },
  { key: "evidence_of_premises", name: "Evidence of trading premises (lease or ownership)" },
];
const APPENDIX_BY_ROUTE = Object.freeze({
  SkilledWorker: [
    { key: "annual_accounts", name: "Latest annual accounts (audited where applicable)" },
    { key: "vat_registration", name: "VAT registration certificate (if VAT registered)" },
  ],
  ScaleUp: [{ key: "scaleup_growth_evidence", name: "Evidence of scale-up growth (annualised growth / HMRC)" }],
  GBM: [{ key: "overseas_link_evidence", name: "Evidence of common ownership / link with the overseas business" }],
  GAE: [{ key: "gae_endorsement", name: "Government Authorised Exchange scheme endorsement" }],
  Student: [{ key: "education_oversight", name: "Educational oversight / accreditation evidence" }],
});

/** Includes for loading the full normalized application graph. */
const fullIncludes = (tenantDb) => [
  { model: tenantDb.LicenceApplicationRoute, as: "routes", separate: true, order: [["id", "ASC"]] },
  { model: tenantDb.LicenceOrganisationInfo, as: "organisationInfo" },
  { model: tenantDb.LicenceCosRequirement, as: "cosRequirements", separate: true, order: [["id", "ASC"]] },
  {
    model: tenantDb.LicenceAppendixDocument,
    as: "appendixDocuments",
    separate: true,
    order: [["id", "ASC"]],
    include: [{ model: tenantDb.User, as: "verifier", attributes: ["id", "first_name", "last_name"], required: false }],
  },
  { model: tenantDb.LicenceAuthorisingOfficer, as: "authorisingOfficer" },
  { model: tenantDb.LicenceKeyContact, as: "keyContact" },
  { model: tenantDb.LicenceLevel1User, as: "level1Users", separate: true, order: [["id", "ASC"]] },
  { model: tenantDb.LicenceDeclaration, as: "declaration" },
];

/**
 * Load the full normalized V2 application graph.
 *
 * @param {object}  tenantDb
 * @param {number}  id            - Application primary key.
 * @param {object}  [opts]
 * @param {number}  [opts.ownerUserId]
 *   When provided, the query is owner-scoped: only the application whose
 *   `userId` matches is returned.  Pass a positive integer for sponsor-owned
 *   access, or omit / pass `undefined` for admin/caseworker access (no filter).
 *
 *   Passing `null` (which happens when the session token is missing a userId)
 *   is treated as a programming error rather than "no filter": it throws a
 *   401 error instead of silently exposing every application in the tenant.
 *   The distinction is:
 *     loadFullApplication(db, id)                → no filter (admin path)
 *     loadFullApplication(db, id, {})             → no filter (admin path)
 *     loadFullApplication(db, id, { ownerUserId: undefined }) → no filter (admin path)
 *     loadFullApplication(db, id, { ownerUserId: null })      → throws 401
 *     loadFullApplication(db, id, { ownerUserId: 0 })         → throws 401
 *     loadFullApplication(db, id, { ownerUserId: 123 })       → filtered  (sponsor path)
 */
export async function loadFullApplication(tenantDb, id, { ownerUserId = undefined } = {}) {
  const where = { id, applicationVersion: APPLICATION_VERSION_V2 };

  if (ownerUserId !== undefined) {
    // Caller requested an ownership-scoped fetch. A null, zero, or non-integer
    // ownerUserId means the session is invalid — throw rather than silently
    // dropping the WHERE clause and returning data for any user.
    if (
      typeof ownerUserId !== "number" ||
      !Number.isFinite(ownerUserId) ||
      ownerUserId <= 0
    ) {
      const err = new Error(
        "ownerUserId must be a positive integer for owner-scoped queries — re-authenticate and try again."
      );
      err.statusCode = 401;
      throw err;
    }
    where.userId = ownerUserId;
  }

  return tenantDb.LicenceApplication.findOne({ where, include: fullIncludes(tenantDb) });
}

/** Seed any required Appendix A documents that are missing for the current routes. */
export async function seedAppendixDocuments(tenantDb, applicationId, organisationId, routeCodes, t = null) {
  const wanted = [...APPENDIX_BASE];
  for (const code of routeCodes || []) {
    for (const doc of APPENDIX_BY_ROUTE[code] || []) wanted.push(doc);
  }
  const existing = await tenantDb.LicenceAppendixDocument.findAll({
    where: { licenceApplicationId: applicationId },
    attributes: ["documentKey"],
    transaction: t,
  });
  const have = new Set(existing.map((d) => d.documentKey));
  const toCreate = wanted
    .filter((d) => !have.has(d.key))
    .map((d) => ({
      licenceApplicationId: applicationId,
      organisationId,
      documentKey: d.key,
      documentName: d.name,
      required: true,
    }));
  if (toCreate.length) await tenantDb.LicenceAppendixDocument.bulkCreate(toCreate, { transaction: t });
}

/** Create a new V2 draft application (status Draft) and seed the base Appendix A list. */
export async function createDraft({ tenantDb, userId, organisationId }) {
  // CRIT-002: Wrap check-and-create in a SERIALIZABLE transaction so that two
  // concurrent requests from the same sponsor cannot both pass the blocking check
  // and both create a Draft application (TOCTOU race window eliminated).
  // The partial unique index `uq_active_v2_application_per_user` provides a DB-level
  // last-resort guard; its UniqueConstraintError is caught and returned as HTTP 409.
  try {
    return await tenantDb.sequelize.transaction(
      { isolationLevel: tenantDb.sequelize.constructor.Transaction.ISOLATION_LEVELS.SERIALIZABLE },
      async (t) => {
        // Re-run the blocking check inside the transaction so no concurrent request
        // can slip past it between the check and the create.
        const blocking = await tenantDb.LicenceApplication.findOne({
          where: {
            userId,
            applicationVersion: APPLICATION_VERSION_V2,
            status: { [Op.notIn]: ["Draft", "Rejected", "Approved", "Licence Granted", "Licence Rejected"] },
            deletedAt: null,
          },
          attributes: ["id", "status"],
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (blocking) {
          const err = new Error(
            `You already have an application under review (${blocking.status}). Please wait for a decision before submitting a new one.`
          );
          err.statusCode = 409;
          err.code = "ACTIVE_APPLICATION_EXISTS";
          throw err;
        }

        const app = await tenantDb.LicenceApplication.create(
          {
            userId,
            organisationId: organisationId ?? null,
            type: "New",
            status: "Draft",
            applicationVersion: APPLICATION_VERSION_V2,
            currentStep: 1,
          },
          { transaction: t }
        );
        await seedAppendixDocuments(tenantDb, app.id, organisationId, [], t);
        return app;
      }
    );
  } catch (err) {
    // CRIT-002: DB unique index `uq_active_v2_application_per_user` fires when a
    // concurrent request inserts before us inside the SERIALIZABLE window.
    if (err instanceof UniqueConstraintError) {
      const conflict = new Error(
        "You already have an active application. Duplicate application creation is not permitted."
      );
      conflict.statusCode = 409;
      conflict.code = "DUPLICATE_ACTIVE_APPLICATION";
      throw conflict;
    }
    throw err;
  }
}

async function upsertOne(Model, applicationId, organisationId, data, t) {
  if (!data || typeof data !== "object") return;
  const existing = await Model.findOne({ where: { licenceApplicationId: applicationId }, transaction: t });
  const payload = { ...data, licenceApplicationId: applicationId, organisationId };
  if (existing) await existing.update(payload, { transaction: t });
  else await Model.create(payload, { transaction: t });
}

async function replaceChildren(Model, applicationId, organisationId, rows, t) {
  if (!Array.isArray(rows)) return;
  await Model.destroy({ where: { licenceApplicationId: applicationId }, transaction: t });
  if (rows.length) {
    await Model.bulkCreate(
      rows.map((r) => ({ ...r, licenceApplicationId: applicationId, organisationId })),
      { transaction: t }
    );
  }
}

/**
 * Apply a (partial) draft body to the normalized tables. Appendix A documents are
 * managed by seeding (on route change) + file upload, not via this body.
 */
export async function saveDraft({ tenantDb, application, body, organisationId }) {
  const appId = application.id;
  await tenantDb.sequelize.transaction(async (t) => {
    if (Number.isInteger(body.currentStep)) {
      await application.update({ currentStep: body.currentStep }, { transaction: t });
    }

    if (Array.isArray(body.routes)) {
      const uniq = [...new Set(body.routes)].filter((r) => ROUTE_CODES.includes(r));
      await tenantDb.LicenceApplicationRoute.destroy({ where: { licenceApplicationId: appId }, transaction: t });
      if (uniq.length) {
        await tenantDb.LicenceApplicationRoute.bulkCreate(
          uniq.map((routeCode) => ({ licenceApplicationId: appId, organisationId, routeCode })),
          { transaction: t }
        );
      }
      await seedAppendixDocuments(tenantDb, appId, organisationId, uniq, t);
    }

    await upsertOne(tenantDb.LicenceOrganisationInfo, appId, organisationId, body.organisationInfo, t);
    await upsertOne(tenantDb.LicenceAuthorisingOfficer, appId, organisationId, body.authorisingOfficer, t);
    await upsertOne(tenantDb.LicenceKeyContact, appId, organisationId, body.keyContact, t);
    await upsertOne(tenantDb.LicenceDeclaration, appId, organisationId, body.declaration, t);

    await replaceChildren(tenantDb.LicenceCosRequirement, appId, organisationId, body.cosRequirements, t);
    await replaceChildren(tenantDb.LicenceLevel1User, appId, organisationId, body.level1Users, t);

    // Recompute the stored fee snapshot from the latest known inputs.
    const fee = computeFee({
      routes: Array.isArray(body.routes) ? body.routes : await currentRouteCodes(tenantDb, appId, t),
      sponsorSize: body.sponsorSize ?? application.feeSponsorSize ?? null,
      charityStatus: body.organisationInfo?.charityStatus ?? false,
      cosRequirements: Array.isArray(body.cosRequirements) ? body.cosRequirements : [],
    });
    await application.update(
      {
        feeSponsorSize: fee.sponsorSizeBand,
        feeBase: fee.applicationFeeTotal,
        feeIscEstimate: fee.immigrationSkillsChargeEstimate,
        feeTotal: fee.applicationFeeTotal,
        feeCurrency: fee.currency,
      },
      { transaction: t }
    );
  });
  return loadFullApplication(tenantDb, appId, { ownerUserId: application.userId });
}

async function currentRouteCodes(tenantDb, appId, t = null) {
  const rows = await tenantDb.LicenceApplicationRoute.findAll({
    where: { licenceApplicationId: appId },
    attributes: ["routeCode"],
    transaction: t,
  });
  return rows.map((r) => r.routeCode);
}

/**
 * Transition a complete draft to Pending (Submitted). Mirrors a few display
 * fields onto the parent so the existing reviewer screens render, and stores the
 * final fee snapshot. Completeness is enforced by the submit validator upstream.
 */
export async function submitApplication({ tenantDb, application }) {
  const appId = application.id;

  const check = validateTransition(WORKFLOW_TYPES.LICENCE, application.status, "Pending");
  if (!check.valid) {
    const err = new Error(check.message);
    err.statusCode = 422;
    throw err;
  }

  const full = await loadFullApplication(tenantDb, appId, { ownerUserId: application.userId });
  const routeCodes = (full.routes || []).map((r) => r.routeCode);

  // Company name comes from the sponsor profile; registration from org info.
  const profile = await tenantDb.SponsorProfile.findOne({ where: { userId: application.userId } });
  const licenceTypeSummary = routeCodes.map((c) => ROUTE_LABELS[c] || c).join(", ");

  // Mirror a primary contact onto the parent so the existing reviewer screens and
  // the "Licence Submitted" notification (which reads contactName) render sensibly.
  const ao = full.authorisingOfficer || {};
  const kc = full.keyContact || {};
  const contact = kc.sameAsAuthorisingOfficer ? ao : kc;
  const contactName =
    [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() || profile?.companyName || "Sponsor";

  const fee = computeFee({
    routes: routeCodes,
    sponsorSize: application.feeSponsorSize ?? null,
    charityStatus: full.organisationInfo?.charityStatus ?? false,
    cosRequirements: full.cosRequirements || [],
  });

  await application.update({
    status: "Pending",
    submittedAt: new Date(),
    currentStep: 8,
    companyName: profile?.companyName || full.organisationInfo?.organisationType || application.companyName || "Sponsor",
    registrationNumber: full.organisationInfo?.companiesHouseNumber || application.registrationNumber || null,
    licenceType: licenceTypeSummary || application.licenceType || null,
    cosAllocation: String((full.cosRequirements || []).length),
    contactName,
    contactEmail: contact.email || application.contactEmail || null,
    contactPhone: contact.phone || application.contactPhone || null,
    feeSponsorSize: fee.sponsorSizeBand,
    feeBase: fee.applicationFeeTotal,
    feeIscEstimate: fee.immigrationSkillsChargeEstimate,
    feeTotal: fee.applicationFeeTotal,
    feeCurrency: fee.currency,
  });

  return loadFullApplication(tenantDb, appId, { ownerUserId: application.userId });
}

/** Shape the full graph for API responses. */
export function serializeApplication(app) {
  if (!app) return null;
  const j = typeof app.toJSON === "function" ? app.toJSON() : app;
  return {
    id: j.id,
    applicationVersion: j.applicationVersion,
    status: j.status,
    type: j.type,
    currentStep: j.currentStep,
    submittedAt: j.submittedAt,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    fee: {
      sponsorSize: j.feeSponsorSize,
      base: j.feeBase,
      iscEstimate: j.feeIscEstimate,
      total: j.feeTotal,
      currency: j.feeCurrency,
    },
    routes: (j.routes || []).map((r) => r.routeCode),
    organisationInfo: j.organisationInfo || null,
    cosRequirements: (j.cosRequirements || []).map((c) => ({
      socCode: c.socCode ?? "",
      roleTitle: c.roleTitle ?? "",
      numberOfWorkers: c.numberOfWorkers ?? 1,
      salary: c.salary ?? "",
      salaryCurrency: c.salaryCurrency ?? "GBP",
      sponsorshipDurationMonths: c.sponsorshipDurationMonths ?? "",
    })),
    appendixDocuments: j.appendixDocuments || [],
    authorisingOfficer: j.authorisingOfficer || null,
    keyContact: j.keyContact || null,
    level1Users: j.level1Users || [],
    declaration: j.declaration || null,
    reviewNotes: j.adminNotes || null,
  };
}

export function splitFullName(name) {
  const parts = (name || "").trim().split(/\s+/);
  const firstName = parts[0] || "";
  const lastName = parts.slice(1).join(" ") || "";
  return { firstName, lastName };
}

/**
 * Sync the licence application's Authorising Officer, Key Contact, Level 1 Users
 * and Company registration FROM the sponsor's Business Profile, which is the
 * primary source of record for this data.
 *
 * Provenance: every record touched is stamped with lastSyncedAt / lastSyncedByUserId
 * so the wizard can show an "Imported From Business Profile" badge with an accurate
 * timestamp.
 *
 * Non-destructive guarantees (so existing applications are never broken):
 *   - AO / KC: only the profile-owned fields (name, email, phone, job title) are
 *     written; compliance fields entered in the wizard (dob, nationality, NI
 *     number, immigration status, convictions) are left untouched.
 *   - Company info: only the registration number maps to companiesHouseNumber and
 *     is filled ONLY when blank — the regulatory fields the profile cannot supply
 *     (PAYE, VAT, SIC codes, etc.) are never cleared.
 *   - Level 1 Users are a full replace (the profile is authoritative for the list).
 */
export async function syncPersonnelFromProfile(tenantDb, applicationId, userId) {
  const application = await tenantDb.LicenceApplication.findByPk(applicationId);
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    throw err;
  }

  const profile = await tenantDb.SponsorProfile.findOne({ where: { userId } });
  if (!profile) {
    return application;
  }

  const syncedAt = new Date();
  const syncStamp = { lastSyncedAt: syncedAt, lastSyncedByUserId: userId ?? null };

  await tenantDb.sequelize.transaction(async (t) => {
    if (profile.authorisingName) {
      const { firstName, lastName } = splitFullName(profile.authorisingName);
      const aoData = {
        firstName,
        lastName,
        email: profile.authorisingEmail || null,
        phone: profile.authorisingPhone || null,
        ...syncStamp,
      };
      const existingAo = await tenantDb.LicenceAuthorisingOfficer.findOne({
        where: { licenceApplicationId: applicationId },
        transaction: t,
      });
      if (existingAo) {
        await existingAo.update(aoData, { transaction: t });
      } else {
        await tenantDb.LicenceAuthorisingOfficer.create({
          licenceApplicationId: applicationId,
          organisationId: application.organisationId,
          ...aoData,
        }, { transaction: t });
      }
    }

    if (profile.keyContactName) {
      const { firstName, lastName } = splitFullName(profile.keyContactName);
      const kcData = {
        firstName,
        lastName,
        email: profile.keyContactEmail || null,
        phone: profile.keyContactPhone || null,
        jobTitle: profile.keyContactDepartment || null,
        ...syncStamp,
      };
      const existingKc = await tenantDb.LicenceKeyContact.findOne({
        where: { licenceApplicationId: applicationId },
        transaction: t,
      });
      if (existingKc) {
        await existingKc.update(kcData, { transaction: t });
      } else {
        await tenantDb.LicenceKeyContact.create({
          licenceApplicationId: applicationId,
          organisationId: application.organisationId,
          ...kcData,
        }, { transaction: t });
      }
    }

    if (Array.isArray(profile.level1Users) && profile.level1Users.length > 0) {
      await tenantDb.LicenceLevel1User.destroy({
        where: { licenceApplicationId: applicationId },
        transaction: t,
      });

      const toCreate = profile.level1Users.map((user) => {
        const { firstName, lastName } = splitFullName(user.name);
        return {
          licenceApplicationId: applicationId,
          organisationId: application.organisationId,
          firstName,
          lastName,
          email: user.email || null,
          phone: user.phone || null,
          jobTitle: user.jobTitle || null,
          ...syncStamp,
        };
      });

      await tenantDb.LicenceLevel1User.bulkCreate(toCreate, { transaction: t });
    }

    // ── Company Information ──────────────────────────────────────────────────
    // The Business Profile's company registration number maps to the wizard's
    // Companies House number. Fill it only when blank (the wizard's regulatory
    // fields — PAYE, VAT, SIC codes — have no profile equivalent and stay as-is).
    if (profile.registrationNumber) {
      const existingOrg = await tenantDb.LicenceOrganisationInfo.findOne({
        where: { licenceApplicationId: applicationId },
        transaction: t,
      });
      if (existingOrg) {
        const patch = { ...syncStamp };
        if (!existingOrg.companiesHouseNumber) patch.companiesHouseNumber = profile.registrationNumber;
        await existingOrg.update(patch, { transaction: t });
      } else {
        await tenantDb.LicenceOrganisationInfo.create({
          licenceApplicationId: applicationId,
          organisationId: application.organisationId,
          companiesHouseNumber: profile.registrationNumber,
          ...syncStamp,
        }, { transaction: t });
      }
    }
  });

  return loadFullApplication(tenantDb, applicationId, { ownerUserId: userId });
}

// Clearer alias — Business Profile is the primary source across personnel + company.
export const syncFromBusinessProfile = syncPersonnelFromProfile;

export default {
  APPLICATION_VERSION_V2,
  ROUTE_CODES,
  ROUTE_LABELS,
  loadFullApplication,
  seedAppendixDocuments,
  createDraft,
  saveDraft,
  submitApplication,
  serializeApplication,
  syncPersonnelFromProfile,
};
