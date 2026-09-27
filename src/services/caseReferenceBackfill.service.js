/**
 * Phase 2 UAT 3.3 — one standard case reference format for every case.
 *
 * Runs per tenant on startup (tenantSeed.service.js):
 *  1. Every live case whose reference is missing or in a legacy format
 *     (CAS-######, Case-NN, …) gets a structured "ORG-TYPEyy-NNN" reference.
 *     Idempotent: once converted, nothing matches on the next boot.
 *  2. ONCE per tenant (recorded in tenant_maintenance_runs): structured
 *     references whose type code does not match the case's visa type — e.g.
 *     "ELIT-SW26-001" on an ILR case — are re-issued. From then on the Case
 *     beforeUpdate hook keeps them in step when the visa type changes.
 *
 * Old references are kept in cases.previousCaseIds, so searches and old links
 * still resolve. Cases are processed oldest first, so new running numbers follow
 * the order cases were opened; each keeps the year it was opened.
 */
import { caseRefNeedsReissue, reissueCaseReference } from "../utils/case.utils.js";
import logger from "../utils/logger.js";

const TYPE_SYNC_KEY = "case-ref-type-sync-v1";

async function maintenanceAlreadyRan(sequelize, key) {
  try {
    const rows = await sequelize.query(
      `SELECT 1 FROM tenant_maintenance_runs WHERE "key" = :key LIMIT 1`,
      { replacements: { key }, type: sequelize.QueryTypes.SELECT },
    );
    return rows.length > 0;
  } catch {
    // Table missing (migration not applied yet) → treat as "can't record", skip.
    return true;
  }
}

async function recordMaintenanceRun(sequelize, key, details) {
  await sequelize.query(
    `INSERT INTO tenant_maintenance_runs ("key", "details") VALUES (:key, CAST(:details AS JSONB))
     ON CONFLICT ("key") DO NOTHING`,
    { replacements: { key, details: JSON.stringify(details || {}) } },
  );
}

export async function normaliseCaseReferencesForDb(tenantDb) {
  if (!tenantDb?.Case || !tenantDb?.sequelize) return { reissued: 0 };
  const { sequelize } = tenantDb;

  const runTypeSync = !(await maintenanceAlreadyRan(sequelize, TYPE_SYNC_KEY));

  const cases = await tenantDb.Case.findAll({
    attributes: ["id", "caseId", "visaTypeId", "organisation_id", "previousCaseIds", "created_at"],
    order: [["created_at", "ASC"], ["id", "ASC"]],
    hooks: false,
  });

  const changes = [];
  for (const c of cases) {
    try {
      const needs = await caseRefNeedsReissue(tenantDb, c, { checkType: runTypeSync });
      if (!needs) continue;
      const { oldRef, newRef } = await sequelize.transaction((transaction) =>
        reissueCaseReference(tenantDb, c, { transaction }),
      );
      changes.push({ id: c.id, from: oldRef, to: newRef });
    } catch (err) {
      logger.warn({ err, caseId: c.id, ref: c.caseId }, "normaliseCaseReferences: re-issue failed");
    }
  }

  if (runTypeSync) {
    await recordMaintenanceRun(sequelize, TYPE_SYNC_KEY, { reissued: changes.length }).catch((err) =>
      logger.warn({ err }, "normaliseCaseReferences: could not record maintenance run"),
    );
  }
  if (changes.length) {
    logger.info(
      { reissued: changes.length, sample: changes.slice(0, 5) },
      "normaliseCaseReferences: case references re-issued to the standard format",
    );
  }
  return { reissued: changes.length, changes };
}

export default normaliseCaseReferencesForDb;
