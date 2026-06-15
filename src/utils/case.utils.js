import logger from "./logger.js";

/**
 * Generate a unique case ID like CAS-000001 within a tenant database.
 * @param {import('../models/buildDb.js').buildDb extends Function ? ReturnType<import('../services/tenantDb.service.js').getTenantDb> : object} tenantDb
 */
export const generateCaseId = async (tenantDb) => {
  try {
    const count = await tenantDb.Case.count({ paranoid: false });
    const nextId = count + 1;
    return `CAS-${String(nextId).padStart(6, "0")}`;
  } catch (error) {
    logger.error({ err: error }, "Error generating case ID");
    return `CAS-${Date.now()}`;
  }
};
