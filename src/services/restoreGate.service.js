/**
 * In-process maintenance gate used while an organisation database is being
 * swapped during a restore. The API runs as a single PM2 instance (fork mode),
 * so process memory is sufficient. Empty set => no behaviour change anywhere.
 */
const restoring = new Set();

export const beginOrgRestore = (orgId) => restoring.add(Number(orgId));
export const endOrgRestore = (orgId) => restoring.delete(Number(orgId));
export const isOrgRestoring = (orgId) => restoring.size > 0 && restoring.has(Number(orgId));
