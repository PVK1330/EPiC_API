import logger from "./logger.js";

/**
 * Generate a sequential, unique case number like Case-01, Case-02 within a tenant database.
 * Uses atomic PostgreSQL sequence for concurrency safety (BUG-023).
 * @param {object} reqOrTenantDb
 * @param {object} [options]
 */
export const generateCaseId = async (reqOrTenantDb, options = {}) => {
  const tenantDb = reqOrTenantDb?.tenantDb || reqOrTenantDb;
  const transaction = options.transaction;
  try {
    // Ensure sequence exists
    await tenantDb.sequelize.query(
      `CREATE SEQUENCE IF NOT EXISTS case_number_seq;`,
      { transaction }
    );

    const [results] = await tenantDb.sequelize.query(
      `SELECT nextval('case_number_seq') AS val;`,
      { transaction }
    );

    const nextVal = parseInt(results[0]?.val, 10) || 1;
    return `Case-${String(nextVal).padStart(2, "0")}`;
  } catch (error) {
    logger.error({ err: error }, "Error generating sequential case number");
    // Fallback: count-based sequence query
    try {
      const count = await tenantDb.Case.count({ paranoid: false, transaction });
      return `Case-${String(count + 1).padStart(2, "0")}`;
    } catch (fallbackError) {
      return `Case-${Date.now()}`;
    }
  }
};
