import db from '../models/index.js';

const Case = db.Case;

/**
 * Generate a unique case ID like CAS-000001, optionally scoped per organisation.
 * @param {number|null|undefined} organisationId
 * @returns {Promise<string>}
 */
export const generateCaseId = async (organisationId = null) => {
  try {
    const where =
      organisationId != null && !Number.isNaN(Number(organisationId))
        ? { organisation_id: Number(organisationId) }
        : {};
    const count = await Case.count({ where, paranoid: false });
    const nextId = count + 1;
    return `CAS-${String(nextId).padStart(6, "0")}`;
  } catch (error) {
    console.error('Error generating case ID:', error);
    return `CAS-${Date.now()}`;
  }
};

