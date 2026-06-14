import { Op } from 'sequelize';

/**
 * Builds a Sequelize WHERE fragment matching Cases whose `assignedcaseworkerId`
 * JSONB array contains the given caseworker userId.
 *
 * The value is strictly coerced to a non-negative integer before being embedded,
 * so it is safe against SQL injection (BUG-001). A non-integer userId yields a
 * clause that matches nothing rather than throwing, keeping callers simple.
 *
 * Both the JSONB containment (`@>`) and key-existence (`?`) forms are retained
 * to match historic data shapes (array of numbers vs. array of strings).
 *
 * @param {import('sequelize').Sequelize} sequelize - tenant Sequelize instance
 * @param {number|string} userId
 * @returns {object} Sequelize where fragment using Op.or
 */
export function buildCaseworkerAssignmentWhere(sequelize, userId) {
  const id = Number(userId);

  // Reject anything that is not a safe non-negative integer; match nothing.
  if (!Number.isInteger(id) || id < 0) {
    return { [Op.and]: sequelize.literal('FALSE') };
  }

  // `id` is now a validated integer literal — no injection surface.
  return {
    [Op.or]: [
      sequelize.literal(`"assignedcaseworkerId"::jsonb @> '${JSON.stringify([id])}'::jsonb`),
      sequelize.literal(`"assignedcaseworkerId"::jsonb ? '${id}'`),
    ],
  };
}
