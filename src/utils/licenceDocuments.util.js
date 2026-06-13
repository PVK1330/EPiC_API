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
  if (!tenantDb?.LicenceAppendixDocument) return [];
  const rows = await tenantDb.LicenceAppendixDocument.findAll({
    where: { licenceApplicationId: applicationId },
    order: [["id", "ASC"]],
  });
  return rows
    .map((r) => r.filePath)
    .filter((p) => typeof p === "string" && p.trim().length > 0);
}

/**
 * Resolve the full, ordered list of document paths for an application:
 * V1 JSON `documents` first, then V2 appendix file paths. Deduplicated so a path
 * that somehow appears in both is not listed twice.
 *
 * @param {object} tenantDb
 * @param {object} application - a LicenceApplication instance/row
 * @returns {Promise<string[]>}
 */
export async function resolveLicenceDocumentPaths(tenantDb, application) {
  const v1 = Array.isArray(application?.documents) ? application.documents : [];
  const v2 = await getAppendixDocumentPaths(tenantDb, application.id);
  const merged = [...v1, ...v2];
  return merged.filter((p, i) => p && merged.indexOf(p) === i);
}
