/**
 * Shared pagination helpers for list endpoints.
 *
 * Keeps page/limit parsing and the response meta shape consistent across
 * controllers so every paginated endpoint returns the same
 * { total, page, limit, totalPages } contract the frontend Pagination
 * component expects.
 */

/**
 * Parse and clamp pagination params from a request query.
 *
 * - page is coerced to an integer >= 1 (NaN / missing -> 1).
 * - limit is coerced to an integer in [1, maxLimit] (NaN / missing -> defaultLimit).
 * - offset is derived for use with Sequelize / SQL OFFSET.
 *
 * @param {object} query                     Express req.query (or any object).
 * @param {object} [opts]
 * @param {number} [opts.defaultLimit=20]    Limit applied when none/invalid is supplied.
 * @param {number} [opts.maxLimit=100]       Upper bound a caller can request.
 * @returns {{ page: number, limit: number, offset: number }}
 */
export function getPaginationParams(query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const rawPage = Number.parseInt(query.page, 10);
  const rawLimit = Number.parseInt(query.limit, 10);

  const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

  let limit = Number.isNaN(rawLimit) ? defaultLimit : rawLimit;
  if (limit < 1) limit = 1;
  if (limit > maxLimit) limit = maxLimit;

  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

/**
 * Build the pagination meta object returned alongside a page of rows.
 *
 * @param {number} total  Total matching records across all pages.
 * @param {number} page   Current 1-based page.
 * @param {number} limit  Page size used for the query.
 * @returns {{ total: number, page: number, limit: number, totalPages: number }}
 */
export function buildPaginationMeta(total, page, limit) {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1;
  const totalPages = Math.ceil(safeTotal / safeLimit);

  return {
    total: safeTotal,
    page,
    limit: safeLimit,
    totalPages,
  };
}
