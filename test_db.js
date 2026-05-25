import 'dotenv/config';
import platformDb from './src/models/index.js';
import { getTenantDb } from './src/services/tenantDb.service.js';
import { buildDocumentLookupMap, findDocumentForChecklistItem } from './src/utils/documentMatch.utils.js';

const UPLOADED_STATUSES = new Set(['uploaded', 'under_review', 'approved']);

async function run() {
  await platformDb.sequelize.authenticate();
  const orgs = await platformDb.Organisation.findAll();
  for (const org of orgs) {
    if (!org.database_name) continue;
    const tenantDb = getTenantDb(org.database_name);
    if (!tenantDb) continue;
    const cases = await tenantDb.Case.findAll({
      where: { caseStage: 'application_preparation' }
    });
    for (const caseRecord of cases) {
      console.log('--- Case ID:', caseRecord.id, 'org:', org.database_name, 'Stage:', caseRecord.caseStage);
      const checklist = await tenantDb.DocumentChecklist.findAll({
        where: { visaTypeId: caseRecord.visaTypeId, isRequired: true }
      });
      const docs = await tenantDb.Document.findAll({
        where: { caseId: caseRecord.id }
      });
      if (caseRecord.candidateId) {
        const orphanDocs = await tenantDb.Document.findAll({
          where: { userId: caseRecord.candidateId, caseId: null }
        });
        docs.push(...orphanDocs);
      }
      const docLookup = buildDocumentLookupMap(docs);
      
      let allApproved = true;
      for (const item of checklist) {
        const doc = findDocumentForChecklistItem(item, docLookup);
        if (!doc) {
          console.log(' [MISSING] doc:', item.name, '|| Type:', item.documentType);
          allApproved = false;
        } else if (!UPLOADED_STATUSES.has(doc.status)) {
          console.log(' [NOT UPLOADED] doc:', doc.documentType, 'Status:', doc.status);
          allApproved = false;
        } else if (doc.status !== 'approved') {
          console.log(' [PENDING] doc:', doc.documentType, 'Status:', doc.status);
          allApproved = false;
        } else {
          console.log(' [APPROVED] doc:', doc.documentType);
        }
      }
      console.log(' -> allApproved:', allApproved);

      // Let's also check if we can force advance it
      if (allApproved) {
         console.log('  Wait, if allApproved is TRUE, then evaluateCaseStageAfterEvent failed to trigger or run. Manually advancing to draft_application_review...');
         await caseRecord.update({ caseStage: 'draft_application_review' });
         console.log('  Advanced case', caseRecord.id, 'to draft_application_review manually.');
      }
    }
  }
}
run().catch(console.error).finally(() => process.exit(0));
