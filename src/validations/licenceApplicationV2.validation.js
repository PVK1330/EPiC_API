import { z } from "zod";

/**
 * Sponsor Licence Application V2 validation.
 *
 * Draft saves are permissive (every section optional) so partial progress can be
 * persisted. `.strict()` on each object rejects unknown keys — that alone blocks
 * server-derived fields (status, organisationId, sponsorId, applicationVersion)
 * from being set through the wizard. Completeness is enforced on submit by
 * validateForSubmission() against the stored graph (submit carries no body).
 */

const routeEnum = z.enum(["SkilledWorker", "Student", "ScaleUp", "GBM", "GAE"]);
const str = (max) => z.string().trim().max(max).optional().nullable();
const normalizeEmptyToNull = (schema) =>
  z
    .preprocess((value) => {
      if (value === "" || value === null) return null;
      return value;
    }, schema.nullable())
    .optional();
const dateStr = normalizeEmptyToNull(z.string().trim().max(40));
const strArray = z.array(z.string().trim().max(255)).optional().nullable();

const normalizeNumberOrNull = (schema) =>
  z
    .preprocess((value) => {
      if (value === "" || value === null) return null;
      return value;
    }, schema.nullable())
    .optional();

const organisationInfoSchema = z
  .object({
    organisationType: str(100),
    companiesHouseNumber: str(20),
    payeReference: str(50),
    accountsOfficeReference: str(50),
    vatNumber: str(30),
    charityStatus: z.boolean().optional().nullable(),
    charityNumber: str(30),
    tradingStartDate: dateStr,
    sicCodes: strArray,
    regions: strArray,
    accreditations: strArray,
    previousTradingNames: strArray,
  })
  .strict();

const cosRequirementSchema = z
  .object({
    socCode: str(10),
    roleTitle: str(255),
    salary: normalizeNumberOrNull(z.coerce.number().nonnegative()),
    salaryCurrency: str(3),
    candidateName: str(255),
    candidateNationality: str(100),
    candidateDob: dateStr,
    candidateEmail: str(255),
    sponsorshipDurationMonths: normalizeNumberOrNull(z.coerce.number().int().min(0).max(600)),
  })
  .strip();

const authorisingOfficerSchema = z
  .object({
    title: str(20),
    firstName: str(120),
    lastName: str(120),
    dob: dateStr,
    nationality: str(100),
    niNumber: str(20),
    immigrationStatus: str(100),
    hasConvictions: z.boolean().optional().nullable(),
    convictionsDetails: str(2000),
    email: str(255),
    phone: str(30),
  })
  .strict();

const keyContactSchema = z
  .object({
    sameAsAuthorisingOfficer: z.boolean().optional().nullable(),
    title: str(20),
    firstName: str(120),
    lastName: str(120),
    email: str(255),
    phone: str(30),
    jobTitle: str(150),
  })
  .strict();

const level1UserSchema = z
  .object({
    firstName: str(120),
    lastName: str(120),
    email: str(255),
    phone: str(30),
    jobTitle: str(150),
    isAuthorisingOfficer: z.boolean().optional().nullable(),
  })
  .strict();

const declarationsSchema = z
  .object({
    accuracyConfirmed: z.boolean().optional().nullable(),
    dutiesUnderstood: z.boolean().optional().nullable(),
    dataConsent: z.boolean().optional().nullable(),
    signatoryName: str(255),
    signatoryRole: str(150),
    signedDate: dateStr,
  })
  .strict();

const draftBody = z
  .object({
    currentStep: z.coerce.number().int().min(1).max(8).optional(),
    sponsorSize: z.enum(["small", "large"]).optional().nullable(),
    routes: z.array(routeEnum).optional(),
    organisationInfo: organisationInfoSchema.optional(),
    cosRequirements: z.array(cosRequirementSchema).max(50).optional(),
    authorisingOfficer: authorisingOfficerSchema.optional(),
    keyContact: keyContactSchema.optional(),
    level1Users: z.array(level1UserSchema).max(20).optional(),
    declaration: declarationsSchema.optional(),
  })
  .strict();

export const saveDraftSchema = z.object({ body: draftBody });

export const feePreviewSchema = z.object({
  body: z
    .object({
      routes: z.array(routeEnum).optional(),
      sponsorSize: z.enum(["small", "large"]).optional().nullable(),
      charityStatus: z.boolean().optional().nullable(),
      cosRequirements: z
        .array(z.object({ sponsorshipDurationMonths: normalizeNumberOrNull(z.coerce.number().int().min(0).max(600)) }).strip())
        .optional(),
    })
    .strict(),
});

const present = (v) => v !== undefined && v !== null && String(v).trim() !== "";

/**
 * Completeness check run on submit against the serialized application graph.
 * Returns an array of { field, message }; empty array means ready to submit.
 */
export function validateForSubmission(app) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });

  if (!Array.isArray(app.routes) || app.routes.length === 0) {
    add("routes", "Select at least one licence route.");
  }

  const org = app.organisationInfo || {};
  if (!present(org.organisationType)) add("organisationInfo.organisationType", "Organisation type is required.");
  if (!present(org.companiesHouseNumber)) add("organisationInfo.companiesHouseNumber", "Companies House number is required.");
  if (!present(org.tradingStartDate)) add("organisationInfo.tradingStartDate", "Trading start date is required.");

  const cos = Array.isArray(app.cosRequirements) ? app.cosRequirements : [];
  if (cos.length === 0) add("cosRequirements", "Add at least one CoS requirement.");
  cos.forEach((c, i) => {
    if (!present(c.socCode)) add(`cosRequirements[${i}].socCode`, "SOC code is required.");
    if (!present(c.roleTitle)) add(`cosRequirements[${i}].roleTitle`, "Role title is required.");
    if (!present(c.salary)) add(`cosRequirements[${i}].salary`, "Salary is required.");
    if (!present(c.sponsorshipDurationMonths)) add(`cosRequirements[${i}].sponsorshipDurationMonths`, "Sponsorship duration is required.");
  });

  const appendix = Array.isArray(app.appendixDocuments) ? app.appendixDocuments : [];
  appendix
    .filter((d) => d.required)
    .forEach((d) => {
      if (!present(d.filePath)) add(`appendix.${d.documentKey}`, `Upload required document: ${d.documentName}.`);
    });

  const ao = app.authorisingOfficer || {};
  ["firstName", "lastName", "dob", "nationality", "niNumber", "immigrationStatus"].forEach((f) => {
    if (!present(ao[f])) add(`authorisingOfficer.${f}`, `Authorising officer ${f} is required.`);
  });
  if (ao.hasConvictions === true && !present(ao.convictionsDetails)) {
    add("authorisingOfficer.convictionsDetails", "Provide details of declared convictions.");
  }

  const kc = app.keyContact || {};
  if (!kc.sameAsAuthorisingOfficer) {
    if (!present(kc.firstName) || !present(kc.lastName)) add("keyContact.name", "Key contact name is required.");
    if (!present(kc.email)) add("keyContact.email", "Key contact email is required.");
    if (!present(kc.phone)) add("keyContact.phone", "Key contact phone is required.");
  }

  const l1 = Array.isArray(app.level1Users) ? app.level1Users : [];
  if (l1.length === 0) add("level1Users", "Add at least one Level 1 user.");
  l1.forEach((u, i) => {
    if (!present(u.firstName) || !present(u.lastName)) add(`level1Users[${i}].name`, "Level 1 user name is required.");
    if (!present(u.email)) add(`level1Users[${i}].email`, "Level 1 user email is required.");
  });

  const dec = app.declaration || {};
  if (dec.accuracyConfirmed !== true) add("declaration.accuracyConfirmed", "You must confirm the information is accurate.");
  if (dec.dutiesUnderstood !== true) add("declaration.dutiesUnderstood", "You must confirm you understand sponsor duties.");
  if (dec.dataConsent !== true) add("declaration.dataConsent", "You must consent to data processing.");
  if (!present(dec.signatoryName)) add("declaration.signatoryName", "Signatory name is required.");
  if (!present(dec.signedDate)) add("declaration.signedDate", "Signed date is required.");

  return errors;
}

export default { saveDraftSchema, feePreviewSchema, validateForSubmission };
