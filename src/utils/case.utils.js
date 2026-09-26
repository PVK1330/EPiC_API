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

async function resolveVisaCode(tenantDb, visaTypeId, transaction) {
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
 */
export const generateCaseId = async (reqOrTenantDb, options = {}) => {
  const tenantDb = reqOrTenantDb?.tenantDb || reqOrTenantDb;
  const { transaction, organisationId = null, visaTypeId = null } = options;

  try {
    const [orgCode, visaCode] = await Promise.all([
      resolveOrganisationCode(tenantDb, organisationId, transaction),
      resolveVisaCode(tenantDb, visaTypeId, transaction),
    ]);
    const yearCode = String(new Date().getFullYear()).slice(-2);
    const orgSeqKey = organisationId != null ? Number(organisationId) : 0;

    // Defensive guard mirroring the previous implementation's style — the
    // migration should already have created this table for every tenant DB,
    // this just protects a DB that hasn't picked up the migration yet.
    if (typeof tenantDb?.sequelize?.query !== 'function') {
      try {
        const count = typeof tenantDb?.Case?.count === 'function' ? await tenantDb.Case.count({ paranoid: false, transaction }) : 0;
        return `Case-${String(count + 1).padStart(2, "0")}`;
      } catch {
        return `Case-${Date.now()}`;
      }
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
    // Fallback: count-based sequence query
    try {
      const count = await tenantDb.Case.count({ paranoid: false, transaction });
      return `Case-${String(count + 1).padStart(2, "0")}`;
    } catch (fallbackError) {
      return `Case-${Date.now()}`;
    }
  }
};
