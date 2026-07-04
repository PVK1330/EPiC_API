/**
 * Licence document resolution — bridges V1 and V2 storage.
 *
 * V1 applications keep their uploaded evidence as an array of disk paths in the
 * `licence_applications.documents` JSON column. V2 applications store the real
 * uploaded evidence in the normalized `licence_appendix_documents` table
 * (`file_path` column). The two viewer surfaces (sponsor / caseworker / admin)
 * were only ever reading the V1 JSON array, so V2 evidence was invisible and
 * un-downloadable.
 *
 * These helpers produce a single, ordered list of effective document paths for
 * an application — V1 paths first, then any V2 appendix file paths — so the
 * existing index-based list + download endpoints work for both versions.
 */

/**
 * Fetch the V2 appendix document file paths for an application (uploaded ones only).
 * Returns [] for V1 apps or when nothing has been uploaded yet.
 *
 * @param {object} tenantDb - the tenant Sequelize models bag (req.tenantDb)
 * @param {number} applicationId
 * @returns {Promise<string[]>}
 */
export async function getAppendixDocumentPaths(tenantDb, applicationId) {
  const entries = await getAppendixDocumentEntries(tenantDb, applicationId);
  return entries.map((e) => e.path);
}

/**
 * Fetch V2 appendix documents (uploaded ones only) as { path, name } entries,
 * where `name` is the human checklist label (e.g. "Sponsor Letter").
 *
 * @param {object} tenantDb
 * @param {number} applicationId
 * @returns {Promise<{ path: string, name: string|null }[]>}
 */
export async function getAppendixDocumentEntries(tenantDb, applicationId) {
  if (!tenantDb?.LicenceAppendixDocument) return [];
  const rows = await tenantDb.LicenceAppendixDocument.findAll({
    where: { licenceApplicationId: applicationId },
    order: [["id", "ASC"]],
  });
  return rows
    .filter((r) => typeof r.filePath === "string" && r.filePath.trim().length > 0)
    .map((r) => ({ path: r.filePath, name: r.documentName || null }));
}

/**
 * Resolve the full, ordered list of document descriptors for an application:
 * V1 JSON `documents` first (no stored label — name is null), then V2 appendix
 * documents carrying their checklist label. Deduplicated by path; when the same
 * path appears in both, the labelled (V2) entry wins the name.
 *
 * @param {object} tenantDb
 * @param {object} application - a LicenceApplication instance/row
 * @returns {Promise<{ path: string, name: string|null }[]>}
 */
export async function resolveLicenceDocumentDescriptors(tenantDb, application) {
  const v1 = (Array.isArray(application?.documents) ? application.documents : [])
    .filter((p) => typeof p === "string" && p.trim().length > 0)
    .map((p) => ({ path: p, name: null }));
  const v2 = await getAppendixDocumentEntries(tenantDb, application.id);

  const byPath = new Map();
  for (const entry of [...v1, ...v2]) {
    const existing = byPath.get(entry.path);
    if (!existing) byPath.set(entry.path, { ...entry });
    else if (!existing.name && entry.name) existing.name = entry.name;
  }
  return [...byPath.values()];
}

/**
 * Resolve the full, ordered list of document paths for an application:
 * V1 JSON `documents` first, then V2 appendix file paths. Deduplicated so a path
 * that somehow appears in both is not listed twice. Index order matches
 * resolveLicenceDocumentDescriptors, so index-based download endpoints stay valid.
 *
 * @param {object} tenantDb
 * @param {object} application - a LicenceApplication instance/row
 * @returns {Promise<string[]>}
 */
export async function resolveLicenceDocumentPaths(tenantDb, application) {
  const descriptors = await resolveLicenceDocumentDescriptors(tenantDb, application);
  return descriptors.map((d) => d.path);
}
