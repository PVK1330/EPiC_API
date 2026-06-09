/**
 * Seeds standard per-visa-type document checklists into a tenant DB.
 *
 * Idempotent: matches each checklist group to an existing visa_types row by
 * keyword (creating it when the group allows), then findOrCreate's each item by
 * (visa_type_id, document_name, case_id IS NULL). Re-running never duplicates and
 * never clobbers admin-added rows.
 */
import {
  VISA_DOCUMENT_CHECKLISTS,
  normaliseVisaName,
  deriveIsRequired,
  deriveCategory,
  deriveDocumentType,
} from "../constants/visaDocumentChecklists.js";
import logger from "../utils/logger.js";

async function resolveVisaTypeId(tenantDb, group, visaTypes) {
  // Match an existing visa type by normalised-name substring (either direction).
  for (const vt of visaTypes) {
    const norm = normaliseVisaName(vt.name);
    if (group.matchers.some((m) => norm.includes(m) || m.includes(norm))) {
      return vt.id;
    }
  }
  if (!group.createIfMissing) return null;

  const nextOrder = visaTypes.length + 1;
  const [created] = await tenantDb.VisaType.findOrCreate({
    where: { name: group.canonicalName },
    defaults: { name: group.canonicalName, sort_order: nextOrder },
  });
  visaTypes.push({ id: created.id, name: created.name }); // keep cache current
  return created.id;
}

export async function seedDocumentChecklistsForDb(tenantDb) {
  if (!tenantDb?.DocumentChecklist || !tenantDb?.VisaType) return;

  const visaTypeRows = await tenantDb.VisaType.findAll({ attributes: ["id", "name"] });
  const visaTypes = visaTypeRows.map((v) => ({ id: v.id, name: v.name }));

  let createdCount = 0;
  for (const group of VISA_DOCUMENT_CHECKLISTS) {
    let visaTypeId;
    try {
      visaTypeId = await resolveVisaTypeId(tenantDb, group, visaTypes);
    } catch (err) {
      logger.warn({ err, group: group.key }, "checklist: visa type resolve failed");
      continue;
    }
    if (!visaTypeId) continue; // no matching visa type and creation not allowed

    for (let i = 0; i < group.items.length; i++) {
      const itemText = group.items[i];
      const documentName = itemText.slice(0, 255);
      try {
        const [, created] = await tenantDb.DocumentChecklist.findOrCreate({
          where: { visaTypeId, documentName, caseId: null },
          defaults: {
            visaTypeId,
            caseId: null,
            documentType: deriveDocumentType(itemText),
            documentName,
            description: null,
            isRequired: deriveIsRequired(itemText),
            sortOrder: i + 1,
            category: deriveCategory(itemText),
          },
        });
        if (created) createdCount += 1;
      } catch (err) {
        logger.warn({ err, group: group.key, documentName }, "checklist: item upsert failed");
      }
    }
  }

  if (createdCount > 0) {
    logger.info({ createdCount }, "seedDocumentChecklists: created checklist items");
  }
}

export default seedDocumentChecklistsForDb;
