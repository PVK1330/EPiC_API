/**
 * Licence Intake Service
 *
 * Owns the Sponsor Information Form (12 fields) and the Document Checklist
 * engine for the Sponsor Licence Intake stage.
 *
 * Responsibilities:
 *  - Idempotently seed the intake form record for an application.
 *  - Seed the document checklist (mandatory + conditional) based on conditions.
 *  - Accept sponsor form submissions and document uploads.
 *  - Accept caseworker document verification / rejection.
 *  - Expose checkIntakeReadiness() used by the Government Registration gate.
 *
 * Government Registration is blocked until:
 *   1. The intake form is marked isComplete = true
 *   2. Every mandatory (isRequired = true) document has status = "verified"
 */

import logger from "../utils/logger.js";
import { recordAuditLog } from "./audit.service.js";
import * as notify from "./sponsorshipNotification.service.js";
import { extractCaseworkerIds } from "./licenceAssignment.service.js";

// ─── Document catalogue ───────────────────────────────────────────────────────

export const MANDATORY_DOCUMENTS = [
  { key: "employer_liability_insurance",  name: "Employer's Liability Insurance Certificate (minimum £5m cover)",         sortOrder: 1 },
  { key: "certificate_of_incorporation",  name: "Certificate of Incorporation or Proof of Business Registration",          sortOrder: 2 },
  { key: "paye_hmrc_registration",        name: "PAYE / HMRC Registration Evidence",                                       sortOrder: 3 },
  { key: "business_bank_statement",       name: "Business Bank Account Statement (last 3 months)",                         sortOrder: 4 },
  { key: "evidence_of_premises",          name: "Evidence of Trading Premises (lease agreement or ownership proof)",       sortOrder: 5 },
  { key: "vat_registration",              name: "VAT Registration Certificate (if VAT-registered)",                        sortOrder: 6 },
  { key: "id_proof_named_person",         name: "Proof of Identity — Named Person on Licence (passport or driving licence)", sortOrder: 7 },
  { key: "right_to_work_named_person",    name: "Right to Work Evidence — Named Person on Licence",                        sortOrder: 8 },
  { key: "company_financials",            name: "Latest Company Accounts or Financial Statements",                         sortOrder: 9 },
  { key: "organisational_chart",          name: "Organisational Chart showing Named Person's reporting line",              sortOrder: 10 },
];

export const CONDITIONAL_DOCUMENTS = {
  food_business: [
    { key: "food_hygiene_certificate",    name: "Food Hygiene Certificate",                                                sortOrder: 20 },
    { key: "food_business_registration",  name: "Food Business Registration (Local Authority)",                            sortOrder: 21 },
  ],
  alcohol_business: [
    { key: "premises_licence",            name: "Premises Licence (Alcohol)",                                              sortOrder: 30 },
    { key: "designated_premises_supervisor", name: "Designated Premises Supervisor Certificate",                           sortOrder: 31 },
  ],
  care_business: [
    { key: "cqc_registration",            name: "CQC Registration Certificate",                                            sortOrder: 40 },
    { key: "dbs_policy",                  name: "DBS Checking Policy and Procedures",                                      sortOrder: 41 },
  ],
  tupe_transfer: [
    { key: "tupe_notification_letter",    name: "TUPE Notification Letter",                                                sortOrder: 50 },
    { key: "existing_employee_list",      name: "List of Employees Being Transferred",                                     sortOrder: 51 },
  ],
  candidate_identified: [
    { key: "candidate_cv",                name: "Candidate CV / Résumé",                                                   sortOrder: 60 },
    { key: "candidate_passport_copy",     name: "Candidate Passport Copy (information page)",                             sortOrder: 61 },
    { key: "candidate_qualifications",    name: "Candidate Relevant Qualifications / Certificates",                        sortOrder: 62 },
  ],
  candidate_not_identified: [
    { key: "recruitment_plan",            name: "Recruitment Plan and Job Advertisement Strategy",                         sortOrder: 70 },
    { key: "genuine_vacancy_evidence",    name: "Evidence of Genuine Vacancy (job description, salary details)",          sortOrder: 71 },
  ],
};

// Maps conditions JSONB keys (camelCase) → conditionType keys (snake_case)
const CONDITION_KEY_MAP = {
  foodBusiness:          "food_business",
  alcoholBusiness:       "alcohol_business",
  careBusiness:          "care_business",
  tupeTransfer:          "tupe_transfer",
  candidateIdentified:   "candidate_identified",
  candidateNotIdentified:"candidate_not_identified",
};

/**
 * Maps an intake checklist documentKey (Stage 10) → the Appendix A documentKey(s)
 * uploaded during the licence application wizard (Stage 4) that satisfy the same
 * evidence requirement. When a sponsor opens the intake checklist, any matching
 * Stage 4 upload is auto-attached so they are not asked to upload it twice.
 *
 * All ten mandatory intake documents now have a Stage 4 equivalent (the wizard's
 * Appendix A base list mirrors MANDATORY_DOCUMENTS), so every mandatory key maps.
 * Two intake keys map to a differently-named appendix key kept for backwards
 * compatibility: certificate_of_incorporation → proof_of_registration and
 * company_financials → annual_accounts. Conditional documents (food hygiene, CQC,
 * etc.) have no Stage 4 equivalent and are intentionally absent — they always
 * require a fresh manual upload. The value is an ordered list of candidate appendix
 * keys — the first one with an uploaded file wins.
 */
export const INTAKE_TO_APPENDIX_MAP = {
  employer_liability_insurance: ["employer_liability_insurance"],
  certificate_of_incorporation: ["proof_of_registration"],
  paye_hmrc_registration:       ["paye_hmrc_registration"],
  business_bank_statement:      ["business_bank_statement"],
  evidence_of_premises:         ["evidence_of_premises"],
  vat_registration:             ["vat_registration"],
  id_proof_named_person:        ["id_proof_named_person"],
  right_to_work_named_person:   ["right_to_work_named_person"],
  company_financials:           ["annual_accounts"],
  organisational_chart:         ["organisational_chart"],
};

/** Source values for an intake document slot. */
export const INTAKE_DOC_SOURCE = Object.freeze({
  MANUAL: "manual",
  IMPORTED: "imported_from_application",
});

/** Filename from a stored path, tolerant of both / and \ separators. */
function baseName(p) {
  if (!p) return null;
  return String(p).split(/[\\/]/).pop() || null;
}

/**
 * Pure helper (unit-testable, no DB): given the intake checklist rows and the
 * application's Appendix A documents, return the list of imports to apply.
 *
 * An intake doc is a candidate for import when it is still empty (status
 * "pending", no filePath) and the sponsor hasn't already uploaded/replaced it.
 * A matching appendix doc must have an actual uploaded file and must not be
 * rejected. Returns [{ intakeDoc, appendixDoc }].
 */
export function planAppendixImports(intakeDocs, appendixDocs) {
  const appendixByKey = new Map();
  for (const a of appendixDocs || []) {
    const usable = a && a.filePath && a.verificationStatus !== "Rejected";
    if (usable && !appendixByKey.has(a.documentKey)) appendixByKey.set(a.documentKey, a);
  }

  const plan = [];
  for (const intakeDoc of intakeDocs || []) {
    // Skip slots the sponsor has already populated or that a caseworker has acted on.
    if (intakeDoc.status !== "pending" || intakeDoc.filePath) continue;
    const candidates = INTAKE_TO_APPENDIX_MAP[intakeDoc.documentKey];
    if (!candidates) continue; // no Stage 4 equivalent — manual upload required
    for (const appKey of candidates) {
      const appendixDoc = appendixByKey.get(appKey);
      if (appendixDoc) {
        plan.push({ intakeDoc, appendixDoc });
        break;
      }
    }
  }
  return plan;
}

/**
 * Auto-attach matching Stage 4 (Appendix A) uploads onto empty Stage 10 intake
 * checklist slots. Marks each as imported (source = imported_from_application)
 * and links the originating appendix document. Idempotent and non-destructive:
 * never touches a slot the sponsor has already uploaded/replaced, and the
 * sponsor can still replace or remove an imported file afterwards.
 *
 * @returns {Promise<number>} how many slots were imported.
 */
export async function importMatchingAppendixDocuments(tenantDb, licenceApplicationId) {
  if (!tenantDb?.LicenceIntakeDocument || !tenantDb?.LicenceAppendixDocument) return 0;

  const [intakeDocs, appendixDocs] = await Promise.all([
    tenantDb.LicenceIntakeDocument.findAll({ where: { licenceApplicationId } }),
    tenantDb.LicenceAppendixDocument.findAll({ where: { licenceApplicationId } }),
  ]);

  const plan = planAppendixImports(intakeDocs, appendixDocs);
  for (const { intakeDoc, appendixDoc } of plan) {
    intakeDoc.filePath = appendixDoc.filePath;
    intakeDoc.fileName = baseName(appendixDoc.filePath);
    intakeDoc.fileMimeType = null;
    intakeDoc.fileSizeBytes = null;
    // Carry over the appendix verification state. If a reviewer already verified the
    // document on the Appendix A view, it must land on the sponsor's checklist as
    // "verified" rather than reverting to "awaiting review". (Rejected appendix docs
    // are never imported — planAppendixImports excludes them.)
    const alreadyVerified = appendixDoc.verificationStatus === "Verified";
    intakeDoc.status = alreadyVerified ? "verified" : "uploaded";
    intakeDoc.uploadedAt = new Date();
    intakeDoc.verifiedAt = alreadyVerified ? appendixDoc.verifiedAt || new Date() : null;
    intakeDoc.verifiedByUserId = alreadyVerified ? appendixDoc.verifiedBy ?? null : null;
    intakeDoc.source = INTAKE_DOC_SOURCE.IMPORTED;
    intakeDoc.sourceAppendixDocumentId = appendixDoc.id;
    intakeDoc.rejectionReason = null;
    intakeDoc.caseworkerNotes = null;
    await intakeDoc.save();
  }
  return plan.length;
}

// ─── Intake form helpers ───────────────────────────────────────────────────────

/** Returns (or creates) the intake form for an application. */
export async function getOrCreateIntakeForm(tenantDb, licenceApplicationId, organisationId) {
  const [form, created] = await tenantDb.LicenceIntakeForm.findOrCreate({
    where: { licenceApplicationId },
    defaults: { licenceApplicationId, organisationId },
  });
  // Prefill from data the sponsor already provided in the wizard / profile so
  // they don't have to re-type it. Runs on first creation AND on any not-yet-
  // submitted form that still has blank prefillable fields (e.g. the NI number
  // captured on the Step 5 Authorising Officer page, which earlier intake forms
  // were created before we pulled through). setIfBlank never overwrites a value
  // the sponsor has typed, so re-running on an incomplete form is safe.
  // Best-effort: a prefill failure must never block the intake summary loading.
  const needsBackfill =
    !form.isComplete && (!form.niNumber || !form.namedPersonOnLicence || !form.emailAddress);
  if (created || needsBackfill) {
    try {
      await prefillIntakeForm(tenantDb, licenceApplicationId, form);
    } catch (err) {
      logger.warn({ err, licenceApplicationId }, "getOrCreateIntakeForm: prefill skipped");
    }
  }
  return form;
}

/**
 * Populate a freshly-created intake form from the sponsor profile + the licence
 * application's wizard data (organisation info, CoS requirements, authorising
 * officer). Only fills BLANK fields — never overwrites anything the sponsor has
 * typed. NI number, total-employee counts and the conditional flags are genuinely
 * new information not captured elsewhere, so they are deliberately left blank.
 */
async function prefillIntakeForm(tenantDb, licenceApplicationId, form) {
  const application = await tenantDb.LicenceApplication.findByPk(licenceApplicationId);
  if (!application) return;

  const [profile, orgInfo, cosReqs, ao] = await Promise.all([
    tenantDb.SponsorProfile.findOne({ where: { userId: application.userId } }).catch(() => null),
    tenantDb.LicenceOrganisationInfo.findOne({ where: { licenceApplicationId } }).catch(() => null),
    tenantDb.LicenceCosRequirement.findAll({ where: { licenceApplicationId } }).catch(() => []),
    tenantDb.LicenceAuthorisingOfficer.findOne({ where: { licenceApplicationId } }).catch(() => null),
  ]);

  const aoName = ao
    ? [ao.firstName, ao.lastName].filter(Boolean).join(" ").trim()
    : null;

  const jobTitles = (cosReqs || [])
    .map((c) => c.roleTitle)
    .filter((t) => t && String(t).trim());

  const cosTotal = (cosReqs || []).reduce(
    (sum, c) => sum + (Number(c.numberOfWorkers) || 0),
    0,
  );

  const premisesAddress = profile
    ? {
        line1: profile.tradingAddress || profile.registeredAddress || "",
        line2: "",
        city: profile.city || "",
        county: profile.state || "",
        postcode: profile.postalCode || "",
        country: profile.country || "",
      }
    : null;

  // Only assign when the source has a usable value; setIfBlank guards against
  // clobbering a value already on the (just-created, normally empty) form.
  const setIfBlank = (field, value) => {
    const cur = form[field];
    const blank = cur === null || cur === undefined || cur === "" || (Array.isArray(cur) && cur.length === 0);
    const hasValue = value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);
    if (blank && hasValue) form[field] = value;
  };

  setIfBlank("tradingName", profile?.tradingName || profile?.companyName);
  setIfBlank("owningLimitedCompany", profile?.companyName);
  setIfBlank("namedPersonOnLicence", aoName || profile?.authorisingName);
  setIfBlank("phoneNumber", ao?.phone || profile?.authorisingPhone || profile?.keyContactPhone);
  // NI number is captured on the Step 5 Authorising Officer wizard page — pull it
  // through so the sponsor isn't asked to re-enter it on the intake form.
  setIfBlank("niNumber", ao?.niNumber);
  setIfBlank("emailAddress", ao?.email || profile?.authorisingEmail || profile?.keyContactEmail || application.contactEmail);
  setIfBlank("companyWebsite", profile?.website);
  setIfBlank("jobTitlesRequired", jobTitles);
  setIfBlank("numberOfCosRequired", cosTotal > 0 ? cosTotal : null);
  if (premisesAddress && premisesAddress.line1) setIfBlank("premisesAddress", premisesAddress);

  await form.save();
}

/**
 * Update intake form fields. Automatically seeds conditional documents when
 * conditions change. Does NOT mark isComplete — use submitIntakeForm() for that.
 */
export async function updateIntakeForm(tenantDb, licenceApplicationId, organisationId, data, userId) {
  const form = await getOrCreateIntakeForm(tenantDb, licenceApplicationId, organisationId);

  // Guard the length-constrained columns so an over-long value returns a clean
  // 400 (the controller maps err.statusCode) instead of a Sequelize 500. The
  // sponsor UI validates these; this covers direct API calls and keeps the
  // failure mode consistent with the rest of the app.
  // Columns: phoneNumber VARCHAR(30), niNumber VARCHAR(20).
  const reject = (message) => {
    const err = new Error(message);
    err.statusCode = 400;
    throw err;
  };
  if (typeof data.phoneNumber === "string" && data.phoneNumber.trim().length > 30) {
    reject("Phone number is too long (max 30 characters).");
  }
  if (typeof data.niNumber === "string" && data.niNumber.trim().length > 20) {
    reject("NI number is too long (max 20 characters).");
  }

  const allowedFields = [
    "tradingName", "premisesAddress", "owningLimitedCompany", "namedPersonOnLicence",
    "phoneNumber", "niNumber", "emailAddress", "jobTitlesRequired",
    "companyWebsite", "totalEmployees", "employeesUnderImmigrationRules",
    "numberOfCosRequired",
  ];

  for (const field of allowedFields) {
    if (data[field] !== undefined) form[field] = data[field];
  }

  const hadConditions = { ...(form.conditions || {}) };
  if (data.conditions && typeof data.conditions === "object") {
    form.conditions = { ...form.conditions, ...data.conditions };
  }

  form.lastUpdatedByUserId = userId;
  await form.save();

  // Reseed conditional documents whenever conditions change
  const newConditions = form.conditions || {};
  const conditionsChanged = JSON.stringify(hadConditions) !== JSON.stringify(newConditions);
  if (conditionsChanged) {
    await seedConditionalDocuments(tenantDb, licenceApplicationId, organisationId, newConditions);
  }

  return form;
}

/**
 * Mark the intake form as complete. All 12 fields must be present.
 * Returns { ok: false, missing: [...] } if validation fails.
 */
export async function submitIntakeForm(tenantDb, licenceApplicationId, organisationId, userId, req) {
  const form = await getOrCreateIntakeForm(tenantDb, licenceApplicationId, organisationId);

  const required = [
    "tradingName", "premisesAddress", "owningLimitedCompany", "namedPersonOnLicence",
    "phoneNumber", "niNumber", "emailAddress", "jobTitlesRequired",
    "companyWebsite", "totalEmployees", "employeesUnderImmigrationRules",
    "numberOfCosRequired",
  ];

  const missing = required.filter((f) => {
    const v = form[f];
    if (v === null || v === undefined || v === "") return true;
    if (Array.isArray(v) && v.length === 0) return true;
    return false;
  });

  if (missing.length > 0) return { ok: false, missing };

  form.isComplete = true;
  form.submittedAt = new Date();
  form.submittedByUserId = userId;
  form.lastUpdatedByUserId = userId;
  await form.save();

  const application = await tenantDb.LicenceApplication.findByPk(licenceApplicationId);
  const caseworkerIds = extractCaseworkerIds(application?.assignedcaseworkerId);

  // Complete the sponsor + caseworker intake_information_form stage tasks so the
  // chain is unblocked. Without this, both roles get a 409 when trying to mark
  // intake_document_checklist complete (checkSequentialOrder sees a pending row).
  // Caseworker "review form" is an acknowledgement step — their real work is
  // document verification at stage 10.
  try {
    const { Op } = tenantDb.Sequelize;
    await tenantDb.LicenceStageTask.update(
      { status: "completed", completedAt: new Date() },
      {
        where: {
          licenceApplicationId,
          stageKey: "intake_information_form",
          role: { [Op.in]: ["sponsor", "caseworker", "admin"] },
          status: { [Op.ne]: "completed" },
        },
      }
    );
  } catch (err) {
    logger.warn({ err }, "submitIntakeForm: failed to auto-complete intake_information_form stage tasks");
  }

  await recordAuditLog({
    tenantDb,
    userId,
    action: "INTAKE_FORM_SUBMITTED",
    resource: `LicenceApplication:${licenceApplicationId}`,
    status: "Success",
    details: `Intake information form submitted for application ${licenceApplicationId}`,
    req,
    organisationId,
  });

  notify
    .intakeFormSubmitted({ tenantDb, application, caseworkerIds, req })
    .catch((err) => logger.error({ err }, "submitIntakeForm: notification failed"));

  return { ok: true, form };
}

// ─── Document checklist helpers ───────────────────────────────────────────────

/** Seed all mandatory documents (idempotent — skips existing keys). */
export async function seedMandatoryDocuments(tenantDb, licenceApplicationId, organisationId) {
  const existing = await tenantDb.LicenceIntakeDocument.findAll({
    where: { licenceApplicationId },
    attributes: ["documentKey"],
  });
  const have = new Set(existing.map((d) => d.documentKey));

  const toCreate = MANDATORY_DOCUMENTS.filter((d) => !have.has(d.key)).map((d) => ({
    licenceApplicationId,
    organisationId,
    documentKey: d.key,
    documentName: d.name,
    category: "mandatory",
    conditionType: null,
    isRequired: true,
    sortOrder: d.sortOrder,
  }));

  if (toCreate.length > 0) {
    await tenantDb.LicenceIntakeDocument.bulkCreate(toCreate, { ignoreDuplicates: true });
  }
}

/** Seed or deactivate conditional documents based on current conditions. */
export async function seedConditionalDocuments(tenantDb, licenceApplicationId, organisationId, conditions) {
  for (const [camelKey, active] of Object.entries(conditions || {})) {
    const conditionType = CONDITION_KEY_MAP[camelKey];
    if (!conditionType) continue;

    const docs = CONDITIONAL_DOCUMENTS[conditionType] || [];
    if (docs.length === 0) continue;

    const existing = await tenantDb.LicenceIntakeDocument.findAll({
      where: { licenceApplicationId, conditionType },
      attributes: ["id", "documentKey", "isRequired"],
    });
    const have = new Set(existing.map((d) => d.documentKey));

    if (active) {
      // Seed missing rows
      const toCreate = docs.filter((d) => !have.has(d.key)).map((d) => ({
        licenceApplicationId,
        organisationId,
        documentKey: d.key,
        documentName: d.name,
        category: "conditional",
        conditionType,
        isRequired: true,
        sortOrder: d.sortOrder,
      }));
      if (toCreate.length > 0) {
        await tenantDb.LicenceIntakeDocument.bulkCreate(toCreate, { ignoreDuplicates: true });
      }
      // Reactivate existing rows (in case they were deactivated)
      if (existing.length > 0) {
        await tenantDb.LicenceIntakeDocument.update(
          { isRequired: true },
          { where: { licenceApplicationId, conditionType } },
        );
      }
    } else {
      // Deactivate existing rows (don't delete — preserve any uploaded files)
      if (existing.length > 0) {
        await tenantDb.LicenceIntakeDocument.update(
          { isRequired: false },
          { where: { licenceApplicationId, conditionType } },
        );
      }
    }
  }
}

/** Seed mandatory + conditional documents based on the stored intake form. */
export async function seedAllDocuments(tenantDb, licenceApplicationId, organisationId) {
  await seedMandatoryDocuments(tenantDb, licenceApplicationId, organisationId);
  const form = await tenantDb.LicenceIntakeForm.findOne({ where: { licenceApplicationId } });
  if (form?.conditions) {
    await seedConditionalDocuments(tenantDb, licenceApplicationId, organisationId, form.conditions);
  }
}

// ─── Document upload ──────────────────────────────────────────────────────────

/**
 * Record a file upload against a checklist slot.
 * fileData = { fileName, filePath, fileMimeType, fileSizeBytes }
 */
export async function recordDocumentUpload(tenantDb, licenceApplicationId, organisationId, documentKey, fileData, userId, req) {
  const doc = await tenantDb.LicenceIntakeDocument.findOne({
    where: { licenceApplicationId, documentKey },
  });

  if (!doc) {
    const err = new Error(`Document key "${documentKey}" not found in checklist`);
    err.statusCode = 404;
    throw err;
  }

  doc.fileName = fileData.fileName;
  doc.filePath = fileData.filePath;
  doc.fileMimeType = fileData.fileMimeType || null;
  doc.fileSizeBytes = fileData.fileSizeBytes || null;
  doc.status = "uploaded";
  doc.uploadedAt = new Date();
  doc.uploadedByUserId = userId;
  // A direct sponsor upload supersedes any imported file — this is now their own.
  doc.source = INTAKE_DOC_SOURCE.MANUAL;
  doc.sourceAppendixDocumentId = null;
  // Clear previous rejection state on re-upload
  doc.rejectionReason = null;
  doc.caseworkerNotes = null;
  await doc.save();

  const application = await tenantDb.LicenceApplication.findByPk(licenceApplicationId);
  const caseworkerIds = extractCaseworkerIds(application?.assignedcaseworkerId);

  await recordAuditLog({
    tenantDb,
    userId,
    action: "INTAKE_DOCUMENT_UPLOADED",
    resource: `LicenceApplication:${licenceApplicationId}`,
    status: "Success",
    details: `Document "${doc.documentName}" uploaded (key: ${documentKey})`,
    req,
    organisationId,
  });

  notify
    .intakeDocumentUploaded({ tenantDb, application, documentName: doc.documentName, caseworkerIds, req })
    .catch((err) => logger.error({ err }, "recordDocumentUpload: notification failed"));

  return doc;
}

// ─── Caseworker document review ───────────────────────────────────────────────

/** Caseworker verifies a document. */
export async function verifyDocument(tenantDb, licenceApplicationId, organisationId, documentKey, caseworkerId, notes, req) {
  const doc = await _requireDoc(tenantDb, licenceApplicationId, documentKey);

  if (doc.status !== "uploaded") {
    const err = new Error(`Document must be in "uploaded" status to verify (current: ${doc.status})`);
    err.statusCode = 400;
    throw err;
  }

  doc.status = "verified";
  doc.verifiedAt = new Date();
  doc.verifiedByUserId = caseworkerId;
  doc.caseworkerNotes = notes || null;
  doc.rejectionReason = null;
  await doc.save();

  // Sync verification back to the linked Appendix A document so the full
  // application view reflects the same status as the intake checklist.
  if (doc.sourceAppendixDocumentId && tenantDb.LicenceAppendixDocument) {
    tenantDb.LicenceAppendixDocument.update(
      { verificationStatus: "Verified", verifiedBy: caseworkerId, verifiedAt: doc.verifiedAt, notes: notes || null },
      { where: { id: doc.sourceAppendixDocumentId } },
    ).catch((err) => logger.warn({ err, docId: doc.sourceAppendixDocumentId }, "verifyDocument: appendix sync failed"));
  }

  const application = await tenantDb.LicenceApplication.findByPk(licenceApplicationId);

  await recordAuditLog({
    tenantDb,
    userId: caseworkerId,
    action: "INTAKE_DOCUMENT_VERIFIED",
    resource: `LicenceApplication:${licenceApplicationId}`,
    status: "Success",
    details: `Document "${doc.documentName}" verified (key: ${documentKey})`,
    req,
    organisationId,
  });

  notify
    .intakeDocumentVerified({ tenantDb, application, documentName: doc.documentName, req })
    .catch((err) => logger.error({ err }, "verifyDocument: notification failed"));

  // Check if all mandatory docs are now verified → fire "ready" notification
  const { isReady } = await checkIntakeReadiness(tenantDb, licenceApplicationId);
  if (isReady) {
    const caseworkerIds = extractCaseworkerIds(application?.assignedcaseworkerId);
    notify
      .intakeReadyForGovernmentRegistration({ tenantDb, application, caseworkerIds, req })
      .catch((err) => logger.error({ err }, "verifyDocument: ready notification failed"));
  }

  return doc;
}

/** Caseworker rejects a document. */
export async function rejectDocument(tenantDb, licenceApplicationId, organisationId, documentKey, reason, caseworkerId, req) {
  const doc = await _requireDoc(tenantDb, licenceApplicationId, documentKey);

  if (!["uploaded", "verified"].includes(doc.status)) {
    const err = new Error(`Document must be in "uploaded" or "verified" status to reject (current: ${doc.status})`);
    err.statusCode = 400;
    throw err;
  }

  doc.status = "rejected";
  doc.rejectionReason = reason || "No reason provided";
  doc.verifiedAt = null;
  doc.verifiedByUserId = null;
  await doc.save();

  // Sync rejection back to the linked Appendix A document.
  if (doc.sourceAppendixDocumentId && tenantDb.LicenceAppendixDocument) {
    tenantDb.LicenceAppendixDocument.update(
      { verificationStatus: "Rejected", verifiedBy: null, verifiedAt: null, notes: doc.rejectionReason },
      { where: { id: doc.sourceAppendixDocumentId } },
    ).catch((err) => logger.warn({ err, docId: doc.sourceAppendixDocumentId }, "rejectDocument: appendix sync failed"));
  }

  const application = await tenantDb.LicenceApplication.findByPk(licenceApplicationId);

  await recordAuditLog({
    tenantDb,
    userId: caseworkerId,
    action: "INTAKE_DOCUMENT_REJECTED",
    resource: `LicenceApplication:${licenceApplicationId}`,
    status: "Success",
    details: `Document "${doc.documentName}" rejected: ${doc.rejectionReason}`,
    req,
    organisationId,
  });

  notify
    .intakeDocumentRejected({ tenantDb, application, documentName: doc.documentName, reason: doc.rejectionReason, req })
    .catch((err) => logger.error({ err }, "rejectDocument: notification failed"));

  return doc;
}

/** Caseworker requests more information on a document. */
export async function requestDocumentInfo(tenantDb, licenceApplicationId, organisationId, documentKey, notes, caseworkerId, req) {
  const doc = await _requireDoc(tenantDb, licenceApplicationId, documentKey);

  doc.status = "information_required";
  doc.caseworkerNotes = notes || null;
  doc.verifiedAt = null;
  doc.verifiedByUserId = null;
  await doc.save();

  const application = await tenantDb.LicenceApplication.findByPk(licenceApplicationId);

  await recordAuditLog({
    tenantDb,
    userId: caseworkerId,
    action: "INTAKE_DOCUMENT_INFO_REQUIRED",
    resource: `LicenceApplication:${licenceApplicationId}`,
    status: "Success",
    details: `More information requested for document "${doc.documentName}": ${notes}`,
    req,
    organisationId,
  });

  notify
    .intakeDocumentInfoRequired({ tenantDb, application, documentName: doc.documentName, notes, req })
    .catch((err) => logger.error({ err }, "requestDocumentInfo: notification failed"));

  return doc;
}

// ─── Appendix document review (V2 wizard — LicenceAppendixDocument) ──────────

/** Caseworker marks an appendix (Appendix A) document as Verified. */
export async function verifyAppendixDocument(tenantDb, licenceApplicationId, documentId, caseworkerId, notes, req) {
  const doc = await tenantDb.LicenceAppendixDocument.findOne({
    where: { id: documentId, licenceApplicationId },
  });
  if (!doc) {
    const err = new Error("Appendix document not found");
    err.statusCode = 404;
    throw err;
  }
  if (doc.verificationStatus === "Verified") return doc; // idempotent

  doc.verificationStatus = "Verified";
  doc.receivedStatus = "Received";
  doc.verifiedBy = caseworkerId ?? null;
  doc.verifiedAt = new Date();
  if (notes) doc.notes = notes;
  await doc.save();

  // Reflect this verification on the sponsor's intake checklist: any intake slot that
  // was imported from this appendix document mirrors the same status, so the sponsor,
  // admin and caseworker all see one consistent verification state. Best-effort —
  // a sync failure must never roll back the appendix verification itself.
  if (tenantDb.LicenceIntakeDocument) {
    tenantDb.LicenceIntakeDocument.update(
      { status: "verified", verifiedAt: doc.verifiedAt, verifiedByUserId: caseworkerId ?? null, rejectionReason: null },
      { where: { licenceApplicationId, sourceAppendixDocumentId: doc.id } },
    ).catch((err) => logger.warn({ err, docId: doc.id }, "verifyAppendixDocument: intake checklist sync failed"));
  }

  const application = await tenantDb.LicenceApplication.findByPk(licenceApplicationId);

  await recordAuditLog({
    tenantDb,
    userId: caseworkerId,
    action: "APPENDIX_DOCUMENT_VERIFIED",
    resource: `LicenceApplication:${licenceApplicationId}`,
    status: "Success",
    details: `Appendix document verified: "${doc.documentName}" (key: ${doc.documentKey})`,
    req,
    organisationId: application?.organisationId,
  }).catch((err) => logger.error({ err }, "verifyAppendixDocument: audit failed"));

  return doc;
}

/**
 * Verify several appendix (Appendix A) documents in one request. Reuses the
 * single-document verify path (so audit logging + idempotency are preserved) and
 * returns a per-document result so one bad/already-handled id never fails the batch.
 */
export async function bulkVerifyAppendixDocuments(tenantDb, licenceApplicationId, documentIds, userId, notes, req) {
  if (!Array.isArray(documentIds) || documentIds.length === 0) {
    const err = new Error("documentIds must be a non-empty array");
    err.statusCode = 400;
    throw err;
  }

  const results = [];
  for (const rawId of documentIds) {
    const documentId = Number(rawId);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      results.push({ documentId: rawId, status: "failed", message: "Invalid document id" });
      continue;
    }
    try {
      const doc = await verifyAppendixDocument(tenantDb, licenceApplicationId, documentId, userId, notes, req);
      results.push({ documentId, status: "verified", documentName: doc.documentName });
    } catch (err) {
      results.push({ documentId, status: "failed", message: err.message });
    }
  }

  const verifiedCount = results.filter((r) => r.status === "verified").length;
  return { verifiedCount, failedCount: results.length - verifiedCount, results };
}

/** Caseworker rejects an appendix document and notifies the sponsor to re-upload. */
export async function rejectAppendixDocument(tenantDb, licenceApplicationId, documentId, reason, caseworkerId, req) {
  const doc = await tenantDb.LicenceAppendixDocument.findOne({
    where: { id: documentId, licenceApplicationId },
  });
  if (!doc) {
    const err = new Error("Appendix document not found");
    err.statusCode = 404;
    throw err;
  }

  doc.verificationStatus = "Rejected";
  doc.verifiedBy = null;
  doc.verifiedAt = null;
  doc.notes = reason || "No reason provided";
  await doc.save();

  // Mirror the rejection onto any linked intake checklist slot so the sponsor sees the
  // same "Rejected" state (and the reason) wherever the document appears. Best-effort.
  if (tenantDb.LicenceIntakeDocument) {
    tenantDb.LicenceIntakeDocument.update(
      { status: "rejected", rejectionReason: doc.notes, verifiedAt: null, verifiedByUserId: null },
      { where: { licenceApplicationId, sourceAppendixDocumentId: doc.id } },
    ).catch((err) => logger.warn({ err, docId: doc.id }, "rejectAppendixDocument: intake checklist sync failed"));
  }

  const application = await tenantDb.LicenceApplication.findByPk(licenceApplicationId);

  await recordAuditLog({
    tenantDb,
    userId: caseworkerId,
    action: "APPENDIX_DOCUMENT_REJECTED",
    resource: `LicenceApplication:${licenceApplicationId}`,
    status: "Success",
    details: `Appendix document rejected: "${doc.documentName}". Reason: ${doc.notes}`,
    req,
    organisationId: application?.organisationId,
  }).catch((err) => logger.error({ err }, "rejectAppendixDocument: audit failed"));

  if (application?.userId) {
    notify.deliver({
      tenantDb,
      recipientUserId: application.userId,
      type: "warning",
      priority: "high",
      category: "sponsorship",
      title: `Document rejected: ${doc.documentName}`,
      message: `Your document "${doc.documentName}" was rejected. Reason: ${doc.notes}. Please re-upload a corrected copy.`,
      entityType: "licence_application",
      entityId: licenceApplicationId,
      actionType: "appendix_document_rejected",
      actionUrl: "/business/licence-process",
      req,
      organisationId: application?.organisationId,
    }).catch((err) => logger.error({ err }, "rejectAppendixDocument: notification failed"));
  }

  return doc;
}

// ─── Readiness check ──────────────────────────────────────────────────────────

/**
 * Check whether an application is ready for Government Registration.
 *
 * Returns { isReady: boolean, reasons: string[] }
 * An empty reasons array means isReady = true.
 */
export async function checkIntakeReadiness(tenantDb, licenceApplicationId) {
  const reasons = [];

  // 1. Intake form must be complete
  const form = await tenantDb.LicenceIntakeForm.findOne({ where: { licenceApplicationId } });
  if (!form || !form.isComplete) {
    reasons.push("Intake information form has not been completed");
  }

  // 2. All mandatory (isRequired = true) documents must be verified
  const docs = await tenantDb.LicenceIntakeDocument.findAll({
    where: { licenceApplicationId, isRequired: true },
  });

  if (docs.length === 0) {
    reasons.push("No mandatory documents found — checklist has not been seeded");
  } else {
    const notVerified = docs.filter((d) => d.status !== "verified");
    if (notVerified.length > 0) {
      const names = notVerified.map((d) => d.documentName).slice(0, 3);
      const extra = notVerified.length > 3 ? ` (+${notVerified.length - 3} more)` : "";
      reasons.push(`${notVerified.length} mandatory document(s) not yet verified: ${names.join(", ")}${extra}`);
    }
  }

  // 3. Ensure all tasks in earlier stages (Stages 1-8) are completed
  if (tenantDb.LicenceStageTask) {
    const { Op } = tenantDb.Sequelize;
    const incompletePrevious = await tenantDb.LicenceStageTask.count({
      where: {
        licenceApplicationId,
        stageOrder: { [Op.lt]: 9 },
        status: { [Op.ne]: "completed" },
      },
    });

    if (incompletePrevious > 0) {
      reasons.push(`${incompletePrevious} task(s) in earlier wizard stages (Stages 1-8) are not yet completed`);
    }
  }

  return { isReady: reasons.length === 0, reasons };
}

// ─── Summary / read ───────────────────────────────────────────────────────────

/**
 * Full intake summary for display (form + categorised document list).
 */
export async function getIntakeSummary(tenantDb, licenceApplicationId, organisationId) {
  await seedAllDocuments(tenantDb, licenceApplicationId, organisationId);

  const form = await getOrCreateIntakeForm(tenantDb, licenceApplicationId, organisationId);

  // Auto-attach matching Stage 4 (Appendix A) uploads so the sponsor isn't asked
  // to provide the same evidence twice. Best-effort — never block the summary.
  await importMatchingAppendixDocuments(tenantDb, licenceApplicationId).catch((err) =>
    logger.warn({ err, licenceApplicationId }, "getIntakeSummary: appendix import skipped"),
  );

  const docs = await tenantDb.LicenceIntakeDocument.findAll({
    where: { licenceApplicationId },
    order: [["sort_order", "ASC"], ["id", "ASC"]],
  });

  const { isReady, reasons } = await checkIntakeReadiness(tenantDb, licenceApplicationId);

  const mandatory = docs.filter((d) => d.category === "mandatory");
  const conditional = docs.filter((d) => d.category === "conditional");

  // Group conditional docs by conditionType for easy rendering
  const conditionalByType = {};
  for (const doc of conditional) {
    if (!conditionalByType[doc.conditionType]) conditionalByType[doc.conditionType] = [];
    conditionalByType[doc.conditionType].push(doc);
  }

  // Dashboard stats
  const total = docs.filter((d) => d.isRequired).length;
  const uploaded = docs.filter((d) => d.isRequired && ["uploaded", "verified"].includes(d.status)).length;
  const verified = docs.filter((d) => d.isRequired && d.status === "verified").length;
  const rejected = docs.filter((d) => d.isRequired && d.status === "rejected").length;
  const pending = docs.filter((d) => d.isRequired && d.status === "pending").length;

  return {
    form,
    documents: docs,
    mandatory,
    conditionalByType,
    readiness: { isReady, reasons },
    stats: { total, uploaded, verified, rejected, pending },
  };
}

/**
 * Dashboard widget counts — used by caseworker and admin dashboards.
 * Returns how many applications in a set have incomplete intake or unverified docs.
 */
export async function getIntakeDashboardCounts(tenantDb, applicationIds) {
  if (!applicationIds || applicationIds.length === 0) return { incompleteForm: 0, pendingVerification: 0 };

  const forms = await tenantDb.LicenceIntakeForm.findAll({
    where: { licenceApplicationId: applicationIds, isComplete: false },
    attributes: ["licenceApplicationId"],
  });

  const unverifiedDocs = await tenantDb.LicenceIntakeDocument.findAll({
    where: {
      licenceApplicationId: applicationIds,
      isRequired: true,
      status: "uploaded",
    },
    attributes: ["licenceApplicationId"],
  });

  const appsWithPendingDocs = new Set(unverifiedDocs.map((d) => d.licenceApplicationId));

  return {
    incompleteForm: forms.length,
    pendingVerification: appsWithPendingDocs.size,
  };
}

// ─── Internal ─────────────────────────────────────────────────────────────────

async function _requireDoc(tenantDb, licenceApplicationId, documentKey) {
  const doc = await tenantDb.LicenceIntakeDocument.findOne({
    where: { licenceApplicationId, documentKey },
  });
  if (!doc) {
    const err = new Error(`Document key "${documentKey}" not found in checklist`);
    err.statusCode = 404;
    throw err;
  }
  return doc;
}
