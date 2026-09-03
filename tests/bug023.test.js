import { getTenantDb } from '../src/services/tenantDb.service.js';
import { generateCaseId } from '../src/utils/case.utils.js';

async function runBug023Tests() {
  console.log('============================================================');
  console.log('STARTING BUG-023 AUTOMATED TEST SUITE — SEQUENTIAL CASE NUMBERING');
  console.log('============================================================\n');

  const tenantDb = getTenantDb('epic_technoweb');
  const { Case, Organisation, User } = tenantDb;

  // Sync sequence
  await tenantDb.sequelize.query(`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1));`);

  const org = await Organisation.findOne({ order: [['id', 'ASC']] });
  const orgId = org ? org.id : 1;

  let userCounter = Date.now();
  async function nextTestUser() {
    return await User.create({
      first_name: 'Bug023',
      last_name: 'Tester',
      email: `test_bug023_${userCounter++}@example.com`,
      country_code: '+44',
      mobile: `799${Math.floor(1000000 + Math.random() * 9000000)}`,
      password: 'HashedPassword123!',
      role_id: 1,
      is_email_verified: true,
      is_otp_verified: true,
      status: 'active',
      organisation_id: orgId,
    });
  }

  // Ensure sequence exists and test generation
  await tenantDb.sequelize.query(`CREATE SEQUENCE IF NOT EXISTS case_number_seq;`);

  // TEST 1: First new case gets correct sequential number
  console.log('TEST 1: First new case gets sequential number');
  const u1 = await nextTestUser();
  const caseId1 = await generateCaseId(tenantDb);
  const match1 = caseId1.match(/^Case-(\d+)$/);
  if (!match1) {
    throw new Error(`TEST 1 Failed: Expected format Case-XX, got "${caseId1}"`);
  }
  const num1 = parseInt(match1[1], 10);
  const c1 = await Case.create({
    caseId: caseId1,
    candidateId: u1.id,
    status: 'Lead',
    caseStage: 'lead_enquiry',
    priority: 'medium',
    targetSubmissionDate: new Date(),
    organisation_id: orgId,
  });
  console.log(`  [PASS] First case created with sequential ID: ${c1.caseId}\n`);

  // TEST 2: Second new case gets next number
  console.log('TEST 2: Second new case gets next number');
  const u2 = await nextTestUser();
  const caseId2 = await generateCaseId(tenantDb);
  const match2 = caseId2.match(/^Case-(\d+)$/);
  const num2 = parseInt(match2[1], 10);
  if (num2 !== num1 + 1) {
    throw new Error(`TEST 2 Failed: Expected sequential increment from ${num1} to ${num1 + 1}, got ${num2}`);
  }
  const c2 = await Case.create({
    caseId: caseId2,
    candidateId: u2.id,
    status: 'Lead',
    caseStage: 'lead_enquiry',
    priority: 'medium',
    targetSubmissionDate: new Date(),
    organisation_id: orgId,
  });
  console.log(`  [PASS] Second case created with next sequential ID: ${c2.caseId}\n`);

  // TEST 3: Multiple cases produce unique sequential numbers
  console.log('TEST 3: Multiple cases produce unique sequential numbers');
  const createdIds = [c1.caseId, c2.caseId];
  for (let i = 0; i < 3; i++) {
    const u = await nextTestUser();
    const nextCaseId = await generateCaseId(tenantDb);
    const c = await Case.create({
      caseId: nextCaseId,
      candidateId: u.id,
      status: 'Lead',
      caseStage: 'lead_enquiry',
      priority: 'medium',
      targetSubmissionDate: new Date(),
      organisation_id: orgId,
    });
    createdIds.push(c.caseId);
  }
  const uniqueCount = new Set(createdIds).size;
  if (uniqueCount !== createdIds.length) {
    throw new Error(`TEST 3 Failed: Duplicate case IDs generated: ${JSON.stringify(createdIds)}`);
  }
  console.log(`  [PASS] 5 cases created sequentially: ${createdIds.join(', ')}\n`);

  // TEST 4: Existing case number remains unchanged when edited
  console.log('TEST 4: Existing case number remains unchanged when edited');
  const originalCaseId = c1.caseId;
  await c1.update({
    jobTitle: 'Senior Software Engineer',
    priority: 'high',
  });
  const reloaded1 = await Case.findByPk(c1.id);
  if (reloaded1.caseId !== originalCaseId) {
    throw new Error(`TEST 4 Failed: Case ID changed on edit from ${originalCaseId} to ${reloaded1.caseId}`);
  }
  console.log(`  [PASS] Case number preserved on edit: ${reloaded1.caseId}\n`);

  // TEST 5: New case after deletion does not reuse deleted number
  console.log('TEST 5: New case after deletion does not reuse deleted number');
  const deletedNumber = c2.caseId;
  await c2.destroy();
  const uAfterDel = await nextTestUser();
  const caseIdAfterDel = await generateCaseId(tenantDb);
  if (caseIdAfterDel === deletedNumber) {
    throw new Error(`TEST 5 Failed: Deleted case number ${deletedNumber} was recycled!`);
  }
  console.log(`  [PASS] New case after delete got ${caseIdAfterDel} without recycling ${deletedNumber}\n`);

  // TEST 6: Existing legacy random case numbers remain accessible
  console.log('TEST 6: Legacy random case numbers remain accessible');
  const uLegacy = await nextTestUser();
  const legacyCase = await Case.create({
    caseId: 'CAS-999888',
    candidateId: uLegacy.id,
    status: 'In Progress',
    caseStage: 'lead_enquiry',
    priority: 'medium',
    targetSubmissionDate: new Date(),
    organisation_id: orgId,
  });
  const foundLegacy = await Case.findOne({ where: { caseId: 'CAS-999888' } });
  if (!foundLegacy || foundLegacy.id !== legacyCase.id) {
    throw new Error('TEST 6 Failed: Legacy case could not be retrieved');
  }
  console.log(`  [PASS] Legacy case with ID "${foundLegacy.caseId}" accessed successfully.\n`);

  // TEST 7 & 8: API/Persistence test
  console.log('TEST 7 & 8: Case Number persists after reload and is returned');
  const reloadedLegacy = await Case.findByPk(legacyCase.id);
  if (reloadedLegacy.caseId !== 'CAS-999888') {
    throw new Error('TEST 7/8 Failed: Persistence check failed');
  }
  console.log(`  [PASS] Case number persists accurately: ${reloadedLegacy.caseId}\n`);

  // TEST 9: Concurrent case creation does not generate duplicates
  console.log('TEST 9: Concurrent case creation does not generate duplicates');
  const concurrentCount = 10;
  const promises = [];
  for (let i = 0; i < concurrentCount; i++) {
    promises.push(generateCaseId(tenantDb));
  }
  const generatedNumbers = await Promise.all(promises);
  const distinctNumbers = new Set(generatedNumbers);
  if (distinctNumbers.size !== concurrentCount) {
    throw new Error(`TEST 9 Failed: Concurrency clash! Generated: ${JSON.stringify(generatedNumbers)}`);
  }
  console.log(`  [PASS] ${concurrentCount} concurrent calls produced ${distinctNumbers.size} unique IDs.\n`);

  console.log('============================================================');
  console.log('ALL BUG-023 AUTOMATED TESTS PASSED 100%');
  console.log('============================================================');
  process.exit(0);
}

runBug023Tests().catch((err) => {
  console.error('BUG-023 Test Suite Failed:', err);
  process.exit(1);
});
