import db from '../models/index.js';
const Case = db.Case;

/**
 * Generate a unique case ID like CAS-000001
 * @returns {Promise<string>}
 */
export const generateCaseId = async () => {
  try {
    const count = await Case.count({ paranoid: false });
    const nextId = count + 1;
    return `CAS-${String(nextId).padStart(6, "0")}`;
  } catch (error) {
    console.error('Error generating case ID:', error);
    // Fallback to timestamp if count fails
    return `CAS-${Date.now()}`;
  }
};
