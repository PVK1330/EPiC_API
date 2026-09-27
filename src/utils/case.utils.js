import { Op, Sequelize } from "sequelize";
import logger from "./logger.js";

const FALLBACK_VISA_CODE = "OTH";
const FALLBACK_ORG_CODE = "ORG";

/** Normalize an admin-set code: trim, upper-case, strip anything but A-Z0-9. */
function normalizeCode(code) {
  if (!code) return null;
  const cleaned = String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned || null;
}

/** Derive a short fallback code from a free-text name (letters only, upper-cased, max 4 chars). */
function deriveCodeFromName(name, maxLen = 4) {
  if (!name) return null;
  const words = String(name).trim().split(/\s+/).map(w => w.replace(/[^a-zA-Z0-9]/g, "")).filter(Boolean);
  if (words.length > 1) {
    const initials = words.map(w => w[0]).join("").toUpperCase();
    return initials.slice(0, maxLen);
  }
  const letters = String(name).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return letters.slice(0, maxLen) || null;
}

async function resolveOrganisationCode(tenantDb, organisationId, transaction) {
  if (organisationId == null || !tenantDb?.Organisation) return FALLBACK_ORG_CODE;
  try {
    const org = await tenantDb.Organisation.findByPk(organisationId, { transaction });
    if (!org) return FALLBACK_ORG_CODE;
    return normalizeCode(org.code) || deriveCodeFromName(org.name) || FALLBACK_ORG_CODE;
  } catch (err) {
    logger.warn({ err, organisationId }, "generateCaseId: failed to resolve organisation code");
    return FALLBACK_ORG_CODE;
  }
}

export async function resolveVisaCode(tenantDb, visaTypeId, transaction) {
  if (visaTypeId == null || !tenantDb?.VisaType) return FALLBACK_VISA_CODE;
  try {
    const visaType = await tenantDb.VisaType.findByPk(visaTypeId, { transaction });
    if (!visaType) return FALLBACK_VISA_CODE;
    return normalizeCode(visaType.code) || deriveCodeFromName(visaType.name, 3) || FALLBACK_VISA_CODE;
  } catch (err) {
    logger.warn({ err, visaTypeId }, "generateCaseId: failed to resolve visa type code");
    return FALLBACK_VISA_CODE;
  }
}

/**
 * Generate a structured, unique Case ID:
 *   [Organisation Code]-[Visa Type Code][2-digit Year]-[Sequential Number]
 *   e.g. EPIC-SW26-001, EPIC-OTH26-004
 * The sequence is atomic per (organisation, visa code, year) via an UPSERT
 * against the case_id_sequences table (BUG-023 concurrency-safety carried
 * forward from the previous single-sequence implementation).
 * Accepts either a req (uses req.tenantDb) or a tenantDb directly, matching
 * every existing call site's convention.
 * @param {object} reqOrTenantDb
 * @param {object} [options]
 * @param {number|null} [options.organisationId]
 * @param {number|null} [options.visaTypeId]
 * @param {import('sequelize').Transaction} [options.transaction]
 * @param {Date|string} [options.referenceDate] date whose year goes in the
 *   reference (default: now). Re-issued references keep the year the case opened.
 */
export const generateCaseId = async (reqOrTenantDb, options = {}) => {
  const tenantDb = reqOrTenantDb?.tenantDb || reqOrTenantDb;
  const { transaction, organisationId = null, visaTypeId = null, referenceDate = null } = options;

  try {
    const [orgCode, visaCode] = await Promise.all([
      resolveOrganisationCode(tenantDb, organisationId, transaction),
      resolveVisaCode(tenantDb, visaTypeId, transaction),
    ]);
    const refDate = referenceDate ? new Date(referenceDate) : new Date();
    const yearCode = String(
      (Number.isNaN(refDate.getTime()) ? new Date() : refDate).getFullYear(),
    ).slice(-2);
    const orgSeqKey = organisationId != null ? Number(organisationId) : 0;

    // Defensive guard mirroring the previous implementation's style — the
    // migration should already have created this table for every tenant DB,
    // this just protects a DB that hasn't picked up the migration yet.
    if (typeof tenantDb?.sequelize?.query !== 'function') {
      return fallbackCaseRef();
    }

    await tenantDb.sequelize.query(
      `CREATE TABLE IF NOT EXISTS case_id_sequences (
        id SERIAL PRIMARY KEY,
        organisation_id INTEGER NOT NULL DEFAULT 0,
        visa_code VARCHAR(20) NOT NULL,
        year_code VARCHAR(2) NOT NULL,
        last_seq INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        UNIQUE (organisation_id, visa_code, year_code)
      );`,
      { transaction }
    );

    const rows = await tenantDb.sequelize.query(
      `INSERT INTO case_id_sequences (organisation_id, visa_code, year_code, last_seq)
       VALUES (:orgId, :visaCode, :yearCode, 1)
       ON CONFLICT (organisation_id, visa_code, year_code)
       DO UPDATE SET last_seq = case_id_sequences.last_seq + 1, updated_at = NOW()
       RETURNING last_seq;`,
      {
        replacements: { orgId: orgSeqKey, visaCode, yearCode },
        type: tenantDb.Sequelize.QueryTypes.SELECT,
        transaction,
      }
    );
    const nextSeq = parseInt(rows?.[0]?.last_seq, 10) || 1;

    return `${orgCode}-${visaCode}${yearCode}-${String(nextSeq).padStart(3, "0")}`;
  } catch (error) {
    logger.error({ err: error }, "Error generating structured case ID");
    return fallbackCaseRef();
  }
};

/** Unique last-resort reference when the sequence table is unavailable. */
function fallbackCaseRef() {
  return `Case-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296).toString(36).toUpperCase()}`;
}

/**
 * Parse a structured reference "ORG-TYPEyy-NNN" → { org, type, year, seq }.
 * Returns null for legacy formats (CAS-######, Case-NN, …) and empty values.
 */
export function parseCaseRef(ref) {
  if (!ref || typeof ref !== "string") return null;
  const m = ref.trim().match(/^([A-Z0-9]+)-([A-Z0-9]+?)(\d{2})-(\d{3,})$/);
  if (!m) return null;
  return { org: m[1], type: m[2], year: m[3], seq: m[4] };
}

/**
 * Should this case get a new reference? Yes when the reference is missing or
 * in a legacy format, or (checkType) when its type code no longer matches the
 * case's visa type — e.g. "ELIT-SW26-001" on an ILR case (Phase 2 UAT 3.3).
 * The firm prefix is deliberately NOT compared: changing the firm code must not
 * renumber every case.
 */
export async function caseRefNeedsReissue(tenantDb, caseRecord, { checkType = true, transaction } = {}) {
  const parsed = parseCaseRef(caseRecord?.caseId);
  if (!parsed) return true;
  if (!checkType) return false;
  const expected = await resolveVisaCode(tenantDb, caseRecord?.visaTypeId ?? null, transaction);
  return parsed.type !== expected;
}

/**
 * Give a case a fresh structured reference (keeping the year it was opened),
 * remember the old one in previousCaseIds, and update the one table that stores
 * the reference as text (escalations.caseId). Model hooks are skipped for the
 * write itself so this never recurses.
 * @returns {Promise<{oldRef: string|null, newRef: string}>}
 */
export async function reissueCaseReference(tenantDb, caseRecord, { transaction } = {}) {
  const oldRef = caseRecord.caseId || null;
  const newRef = await generateCaseId(tenantDb, {
    organisationId: caseRecord.organisation_id ?? null,
    visaTypeId: caseRecord.visaTypeId ?? null,
    referenceDate: caseRecord.created_at || caseRecord.createdAt || null,
    transaction,
  });
  const previous = Array.isArray(caseRecord.previousCaseIds) ? caseRecord.previousCaseIds : [];
  const previousCaseIds = oldRef && !previous.includes(oldRef) ? [...previous, oldRef] : previous;

  await tenantDb.Case.update(
    { caseId: newRef, previousCaseIds },
    { where: { id: caseRecord.id }, hooks: false, paranoid: false, transaction },
  );
  if (oldRef && tenantDb.Escalation) {
    await tenantDb.Escalation.update(
      { caseId: newRef },
      { where: { caseId: oldRef }, hooks: false, transaction },
    ).catch((err) => logger.warn({ err, oldRef, newRef }, "reissueCaseReference: escalation update failed"));
  }
  return { oldRef, newRef };
}

/**
 * BUG-017 / Phase 2 UAT: a case is assigned to ONE caseworker only.
 * Returns an error message when the submitted caseworker ids contain more than
 * one distinct caseworker, otherwise null. Accepts an array, a single id, or
 * nothing (null/undefined/"" are ignored).
 */
export const SINGLE_CASEWORKER_MESSAGE = "A case can only be assigned to one caseworker.";

export const singleCaseworkerError = (ids) => {
  const list = Array.isArray(ids) ? ids : ids != null && ids !== "" ? [ids] : [];
  const distinct = new Set(
    list
      .filter((id) => id !== null && id !== undefined && id !== "")
      .map((id) => String(Number(id) || id)),
  );
  return distinct.size > 1 ? SINGLE_CASEWORKER_MESSAGE : null;
};

/**
 * Search condition matching a case by a reference it USED to have (kept in
 * previousCaseIds after re-issue), for list searches on the Case model.
 */
export const previousCaseRefSearch = (search) =>
  Sequelize.where(Sequelize.cast(Sequelize.col("Case.previousCaseIds"), "text"), {
    [Op.iLike]: `%${search}%`,
  });
