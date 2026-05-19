/** Normalize document type/name for checklist matching */
export const normalizeDocKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/** Latest document per normalized type/name key */
export function buildDocumentLookupMap(documents = []) {
  const map = new Map();
  for (const doc of documents) {
    const keys = [doc.documentType, doc.documentName, doc.userFileName]
      .filter(Boolean)
      .map(normalizeDocKey);
    for (const key of keys) {
      const existing = map.get(key);
      const docTime = new Date(doc.uploadedAt || doc.created_at || 0).getTime();
      const existingTime = existing
        ? new Date(existing.uploadedAt || existing.created_at || 0).getTime()
        : 0;
      if (!existing || docTime >= existingTime) {
        map.set(key, doc);
      }
    }
  }
  return map;
}

export function findDocumentForChecklistItem(item, lookupMap) {
  if (!lookupMap || !item) return null;
  const keys = [item.documentType, item.documentName]
    .filter(Boolean)
    .map(normalizeDocKey);
  for (const key of keys) {
    if (lookupMap.has(key)) return lookupMap.get(key);
  }
  return null;
}
