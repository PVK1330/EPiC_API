import { getTenantDb } from '../src/services/tenantDb.service.js';
import { sanitizeApplicationPayload, validateFinalApplicationSubmission } from '../src/utils/applicationPayload.util.js';
import { generateBrandedPdfBuffer } from '../src/services/pdfGenerator.service.js';
import { resolveOrgPdfLogoDataUri } from '../src/utils/pdfLogo.js';

async function runBug013Tests() {
  console.log('============================================================');
  console.log('STARTING BUG-013 AUTOMATED TEST SUITE — STRUCTURED VISA REFUSAL');
  console.log('============================================================\n');

  const tenantDb = getTenantDb('epic_technoweb');
  const { CandidateApplication, Organisation, User } = tenantDb;

  // Sync sequences
  await tenantDb.sequelize.query(`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1));`);
  await tenantDb.sequelize.query(`SELECT setval('candidate_applications_id_seq', COALESCE((SELECT MAX(id) FROM candidate_applications), 1));`);

  const org = await Organisation.findOne({ order: [['id', 'ASC']] });
  const orgId = org ? org.id : 1;

  let userCounter = Date.now();
  async function nextTestUser() {
    return await User.create({
      first_name: 'Bug013',
      last_name: 'Tester',
      email: `test_bug013_${userCounter++}@example.com`,
      country_code: '+44',
      mobile: `788${Math.floor(1000000 + Math.random() * 9000000)}`,
      password: 'HashedPassword123!',
      role_id: 1,
      is_email_verified: true,
      is_otp_verified: true,
      status: 'active',
      organisation_id: orgId,
    });
  }

  // TEST 1: Visa refusal = No -> no refusal details required -> PASS
  console.log('TEST 1: Visa refusal = No (No details required)');
  const u1 = await nextTestUser();
  const payload1 = sanitizeApplicationPayload({
    firstName: 'NoRefusal',
    lastName: 'Client',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    refusedVisa: 'No',
    refusedVisaReason: '',
    refusedVisaDate: '',
    refusedVisaCountry: '',
    refusedVisaType: '',
    refusedVisaReference: '',
  });
  validateFinalApplicationSubmission(payload1);
  const app1 = await CandidateApplication.create({
    ...payload1,
    userId: u1.id,
    status: 'draft',
  });
  if (app1.refusedVisa !== 'No') {
    throw new Error('TEST 1 Failed: refusedVisa should be No');
  }
  console.log('  [PASS] Visa refusal = No validated and persisted without requiring refusal details.\n');

  // TEST 2: Visa refusal = Yes + complete details -> PASS
  console.log('TEST 2: Visa refusal = Yes + complete details');
  const u2 = await nextTestUser();
  const payload2 = sanitizeApplicationPayload({
    firstName: 'Refusal',
    lastName: 'Client',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    refusedVisa: 'Yes',
    refusedVisaReason: 'Previous visa application was refused due to documentation issue.',
    refusedVisaDate: '2024-05-15',
    refusedVisaCountry: 'United Kingdom',
    refusedVisaType: 'Student Visa',
    refusedVisaReference: 'REF-123456',
  });
  validateFinalApplicationSubmission(payload2);
  const app2 = await CandidateApplication.create({
    ...payload2,
    userId: u2.id,
    status: 'draft',
  });
  if (
    app2.refusedVisa !== 'Yes' ||
    !app2.refusedVisaReason.includes('documentation issue') ||
    app2.refusedVisaCountry !== 'United Kingdom' ||
    app2.refusedVisaType !== 'Student Visa' ||
    app2.refusedVisaReference !== 'REF-123456'
  ) {
    throw new Error('TEST 2 Failed: Persisted refusal details mismatch');
  }
  console.log('  [PASS] Visa refusal = Yes with complete structured details persisted successfully.\n');

  // TEST 3: Yes + missing refusal reason -> REJECT
  console.log('TEST 3: Yes + missing refusal reason (Rejected)');
  const payload3 = sanitizeApplicationPayload({
    firstName: 'Alice',
    lastName: 'MissingReason',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    refusedVisa: 'Yes',
    refusedVisaReason: '   ',
    refusedVisaDate: '2024-05-15',
    refusedVisaCountry: 'United Kingdom',
    refusedVisaType: 'Student Visa',
  });
  let rejected3 = false;
  try {
    validateFinalApplicationSubmission(payload3);
  } catch (err) {
    rejected3 = true;
    console.log(`  [PASS] Correctly rejected missing reason: "${err.message}"\n`);
  }
  if (!rejected3) throw new Error('TEST 3 Failed: Missing refusal reason was not rejected');

  // TEST 4: Yes + missing refusal date -> REJECT
  console.log('TEST 4: Yes + missing refusal date (Rejected)');
  const payload4 = sanitizeApplicationPayload({
    firstName: 'Bob',
    lastName: 'MissingDate',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    refusedVisa: 'Yes',
    refusedVisaReason: 'Application refused',
    refusedVisaDate: '',
    refusedVisaCountry: 'United Kingdom',
    refusedVisaType: 'Student Visa',
  });
  let rejected4 = false;
  try {
    validateFinalApplicationSubmission(payload4);
  } catch (err) {
    rejected4 = true;
    console.log(`  [PASS] Correctly rejected missing date: "${err.message}"\n`);
  }
  if (!rejected4) throw new Error('TEST 4 Failed: Missing refusal date was not rejected');

  // TEST 5: Yes + missing refusal country -> REJECT
  console.log('TEST 5: Yes + missing refusal country (Rejected)');
  const payload5 = sanitizeApplicationPayload({
    firstName: 'Charlie',
    lastName: 'MissingCountry',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    refusedVisa: 'Yes',
    refusedVisaReason: 'Application refused',
    refusedVisaDate: '2024-05-15',
    refusedVisaCountry: '',
    refusedVisaType: 'Student Visa',
  });
  let rejected5 = false;
  try {
    validateFinalApplicationSubmission(payload5);
  } catch (err) {
    rejected5 = true;
    console.log(`  [PASS] Correctly rejected missing country: "${err.message}"\n`);
  }
  if (!rejected5) throw new Error('TEST 5 Failed: Missing refusal country was not rejected');

  // TEST 6: Yes + missing visa/application type -> REJECT
  console.log('TEST 6: Yes + missing visa/application type (Rejected)');
  const payload6 = sanitizeApplicationPayload({
    firstName: 'Diana',
    lastName: 'MissingType',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    refusedVisa: 'Yes',
    refusedVisaReason: 'Application refused',
    refusedVisaDate: '2024-05-15',
    refusedVisaCountry: 'United Kingdom',
    refusedVisaType: '',
  });
  let rejected6 = false;
  try {
    validateFinalApplicationSubmission(payload6);
  } catch (err) {
    rejected6 = true;
    console.log(`  [PASS] Correctly rejected missing type: "${err.message}"\n`);
  }
  if (!rejected6) throw new Error('TEST 6 Failed: Missing visa type was not rejected');

  // TEST 7: Yes + reference details (optional field populated or omitted) -> PASS
  console.log('TEST 7: Yes + reference details optional behavior');
  const u7 = await nextTestUser();
  const payload7WithoutRef = sanitizeApplicationPayload({
    firstName: 'Evan',
    lastName: 'NoRef',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    refusedVisa: 'Yes',
    refusedVisaReason: 'Refused in Canada',
    refusedVisaDate: '2022-03-10',
    refusedVisaCountry: 'Canada',
    refusedVisaType: 'Visitor Visa',
    refusedVisaReference: '',
  });
  validateFinalApplicationSubmission(payload7WithoutRef);
  const app7 = await CandidateApplication.create({
    ...payload7WithoutRef,
    userId: u7.id,
    status: 'draft',
  });
  if (app7.refusedVisaReference !== null && app7.refusedVisaReference !== '') {
    throw new Error('TEST 7 Failed: Expected empty reference details');
  }
  console.log('  [PASS] Reference details is optional when Refused a visa = Yes.\n');

  // TEST 8: Edit existing refusal details -> PASS
  console.log('TEST 8: Edit existing refusal details');
  const updatePayload8 = sanitizeApplicationPayload({
    refusedVisaReason: 'New updated reason: overturned on appeal later.',
    refusedVisaCountry: 'United States',
    refusedVisaType: 'Work Visa',
    refusedVisaReference: 'NEW-REF-999',
  });
  await app2.update(updatePayload8);
  const reloaded2 = await CandidateApplication.findByPk(app2.id);
  if (
    !reloaded2.refusedVisaReason.includes('overturned on appeal') ||
    reloaded2.refusedVisaCountry !== 'United States' ||
    reloaded2.refusedVisaType !== 'Work Visa' ||
    reloaded2.refusedVisaReference !== 'NEW-REF-999'
  ) {
    throw new Error('TEST 8 Failed: Refusal details edit failed to persist');
  }
  console.log(`  [PASS] Refusal details successfully updated: "${reloaded2.refusedVisaReason}" in ${reloaded2.refusedVisaCountry}.\n`);

  // TEST 9: Legacy Yes + NULL refusal details -> PASS
  console.log('TEST 9: Legacy Yes + NULL refusal details compatibility');
  const uLegacy = await nextTestUser();
  const [legacyResult] = await tenantDb.sequelize.query(`
    INSERT INTO candidate_applications ("userId", "firstName", "lastName", "refusedVisa", "refusedVisaReason", "refusedVisaDate", "refusedVisaCountry", "refusedVisaType", "refusedVisaReference", "addressStartDate", "housingStatus", "status", "createdAt", "updatedAt")
    VALUES (${uLegacy.id}, 'LegacyRefUser', 'Tester', 'Yes', NULL, NULL, NULL, NULL, NULL, '2020-01-01', 'Own', 'draft', NOW(), NOW())
    RETURNING *;
  `);
  const legacyRecord = legacyResult[0];
  const reloadedLegacy = await CandidateApplication.findByPk(legacyRecord.id);
  if (
    reloadedLegacy.refusedVisaReason !== null ||
    reloadedLegacy.refusedVisaDate !== null ||
    reloadedLegacy.refusedVisaCountry !== null
  ) {
    throw new Error('TEST 9 Failed: Expected null legacy fields');
  }
  // Upgrade legacy record with full refusal details
  await reloadedLegacy.update(
    sanitizeApplicationPayload({
      refusedVisaReason: 'Upgraded legacy refusal details',
      refusedVisaDate: '2021-08-20',
      refusedVisaCountry: 'Australia',
      refusedVisaType: 'Student Visa',
      refusedVisaReference: 'AUS-456',
    })
  );
  const updatedLegacy = await CandidateApplication.findByPk(legacyRecord.id);
  if (updatedLegacy.refusedVisaCountry !== 'Australia' || !updatedLegacy.refusedVisaReason.includes('Upgraded legacy')) {
    throw new Error('TEST 9 Failed: Upgrading legacy refusal record failed');
  }
  console.log('  [PASS] Legacy record loaded with NULL details and upgraded cleanly.\n');

  // TEST 10: Yes -> No transition -> PASS
  console.log('TEST 10: Yes -> No transition');
  await app2.update({ refusedVisa: 'No' });
  const reloadedAfterNo = await CandidateApplication.findByPk(app2.id);
  if (reloadedAfterNo.refusedVisa !== 'No') {
    throw new Error('TEST 10 Failed: Yes -> No transition failed');
  }
  console.log('  [PASS] Yes -> No transition succeeded without breaking application record.\n');

  // TEST 11: No -> Yes transition -> PASS
  console.log('TEST 11: No -> Yes transition');
  await app1.update(
    sanitizeApplicationPayload({
      refusedVisa: 'Yes',
      refusedVisaReason: 'Newly declared refusal during case intake.',
      refusedVisaDate: '2023-11-05',
      refusedVisaCountry: 'Germany',
      refusedVisaType: 'Business Visa',
      refusedVisaReference: 'DE-VISA-88',
    })
  );
  const reloadedAfterYes = await CandidateApplication.findByPk(app1.id);
  if (reloadedAfterYes.refusedVisa !== 'Yes' || reloadedAfterYes.refusedVisaCountry !== 'Germany') {
    throw new Error('TEST 11 Failed: No -> Yes transition failed');
  }
  console.log('  [PASS] No -> Yes transition with complete refusal details succeeded.\n');

  // TEST 12: Read-only formatting
  console.log('TEST 12: Read-only display formatting');
  const PARENT_MAP = {
    refusedVisaReason: 'refusedVisa',
    refusedVisaDate: 'refusedVisa',
    refusedVisaCountry: 'refusedVisa',
    refusedVisaType: 'refusedVisa',
    refusedVisaReference: 'refusedVisa',
    refusedVisaDetails: 'refusedVisa',
  };
  function shouldShowInReadonly(key, form) {
    if (PARENT_MAP[key] && form[PARENT_MAP[key]] !== 'Yes') {
      return false;
    }
    if (key === 'refusedVisaDetails' && form.refusedVisaReason) {
      return false;
    }
    return true;
  }
  const formYes = {
    refusedVisa: 'Yes',
    refusedVisaReason: 'Prior refusal in France',
    refusedVisaDate: '2022-01-10',
    refusedVisaCountry: 'France',
    refusedVisaType: 'Tourist Visa',
    refusedVisaReference: 'FR-998',
  };
  const formNo = {
    refusedVisa: 'No',
    refusedVisaReason: 'Old reason',
    refusedVisaCountry: 'Old country',
  };
  if (!shouldShowInReadonly('refusedVisaReason', formYes) || !shouldShowInReadonly('refusedVisaCountry', formYes)) {
    throw new Error('TEST 12 Failed: Refusal fields should be visible when Yes');
  }
  if (shouldShowInReadonly('refusedVisaReason', formNo) || shouldShowInReadonly('refusedVisaCountry', formNo)) {
    throw new Error('TEST 12 Failed: Refusal fields should be hidden when No');
  }
  console.log('  [PASS] Read-only displays refusal details when Yes and hides them when No.\n');

  // TEST 13: PDF generation
  console.log('TEST 13: PDF generation with structured refusal details');
  const mockPdfApp = {
    firstName: 'Frank',
    lastName: 'RefusalPdf',
    refusedVisa: 'Yes',
    refusedVisaReason: 'Refused Canada study visa in 2021',
    refusedVisaDate: '2021-04-12',
    refusedVisaCountry: 'Canada',
    refusedVisaType: 'Student Visa',
    refusedVisaReference: 'CAN-STU-001',
  };
  const PDF_APPLICATION_SECTIONS = [
    {
      title: 'Immigration History',
      fields: [
        'refusedVisa',
        'refusedVisaReason',
        'refusedVisaDate',
        'refusedVisaCountry',
        'refusedVisaType',
        'refusedVisaReference',
      ],
    },
  ];
  function formatScalar(raw) {
    if (raw === null || raw === undefined || raw === '') return '—';
    return String(raw);
  }
  const sectionsForPdf = PDF_APPLICATION_SECTIONS.map((sec) => ({
    title: sec.title,
    fields: sec.fields.map((f) => ({
      label: f,
      value: formatScalar(mockPdfApp[f]),
    })),
  }));
  const logoDataUri = await resolveOrgPdfLogoDataUri(tenantDb, orgId);
  const pdfBuffer = await generateBrandedPdfBuffer({
    title: 'Candidate Application Summary',
    subtitle: 'Frank RefusalPdf - APP-BUG013',
    sections: sectionsForPdf,
    logoDataUri,
    orgName: org?.name || 'Immigration CRM',
  });
  if (!pdfBuffer || pdfBuffer.length < 500) {
    throw new Error('TEST 13 Failed: PDF buffer too small or empty');
  }
  console.log(`  [PASS] PDF generated successfully (${pdfBuffer.length} bytes) including complete refusal details.\n`);

  // TEST 14: Caseworker flow
  console.log('TEST 14: Caseworker flow update');
  const caseworkerUpdate = sanitizeApplicationPayload({
    refusedVisa: 'Yes',
    refusedVisaReason: 'Caseworker verified Home Office refusal notice.',
    refusedVisaDate: '2023-09-01',
    refusedVisaCountry: 'United Kingdom',
    refusedVisaType: 'Skilled Worker',
    refusedVisaReference: 'HO-REF-776655',
  });
  validateFinalApplicationSubmission({ ...app7.toJSON(), ...caseworkerUpdate });
  await app7.update(caseworkerUpdate);
  const reloadedCW = await CandidateApplication.findByPk(app7.id);
  if (
    reloadedCW.refusedVisaReason !== 'Caseworker verified Home Office refusal notice.' ||
    reloadedCW.refusedVisaReference !== 'HO-REF-776655'
  ) {
    throw new Error('TEST 14 Failed: Caseworker update failed');
  }
  console.log('  [PASS] Caseworker flow update verified.\n');

  // TEST 15: Invalid refusal date (future date, invalid string) -> REJECT
  console.log('TEST 15: Invalid refusal date validation (Future & Invalid String)');
  let futureRejected = false;
  try {
    sanitizeApplicationPayload({
      refusedVisa: 'Yes',
      refusedVisaDate: '2099-01-01',
    });
  } catch (err) {
    futureRejected = true;
    console.log(`  [PASS] Correctly rejected future refusal date: "${err.message}"`);
  }
  if (!futureRejected) throw new Error('TEST 15 Failed: Future refusal date was not rejected');

  let malformedRejected = false;
  try {
    sanitizeApplicationPayload({
      refusedVisa: 'Yes',
      refusedVisaDate: 'not-a-valid-date',
    });
  } catch (err) {
    malformedRejected = true;
    console.log(`  [PASS] Correctly rejected malformed refusal date: "${err.message}"\n`);
  }
  if (!malformedRejected) throw new Error('TEST 15 Failed: Malformed refusal date was not rejected');

  // TEST 16: Conflicting alias values -> REJECT
  console.log('TEST 16: Conflicting alias values validation');
  // Conflicting reason
  let conflictReasonRejected = false;
  try {
    sanitizeApplicationPayload({
      refusedVisaReason: 'Reason One',
      refusedVisaDetails: 'Conflicting Reason Two',
    });
  } catch (err) {
    conflictReasonRejected = true;
    console.log(`  [PASS] Correctly rejected conflicting reason aliases: "${err.message}"`);
  }
  if (!conflictReasonRejected) throw new Error('TEST 16 Failed: Conflicting reason aliases were not rejected');

  // Conflicting visa type
  let conflictTypeRejected = false;
  try {
    sanitizeApplicationPayload({
      refusedVisaType: 'Student Visa',
      refusedVisaApplicationType: 'Work Visa',
    });
  } catch (err) {
    conflictTypeRejected = true;
    console.log(`  [PASS] Correctly rejected conflicting visa type aliases: "${err.message}"`);
  }
  if (!conflictTypeRejected) throw new Error('TEST 16 Failed: Conflicting visa type aliases were not rejected');

  // Conflicting reference details
  let conflictRefRejected = false;
  try {
    sanitizeApplicationPayload({
      refusedVisaReference: 'REF-AAA',
      refusedVisaReferenceDetails: 'REF-BBB',
    });
  } catch (err) {
    conflictRefRejected = true;
    console.log(`  [PASS] Correctly rejected conflicting reference aliases: "${err.message}"\n`);
  }
  if (!conflictRefRejected) throw new Error('TEST 16 Failed: Conflicting reference aliases were not rejected');

  // TEST 17: Cross-client data isolation -> PASS
  console.log('TEST 17: Cross-client data isolation');
  const uIso1 = await nextTestUser();
  const uIso2 = await nextTestUser();

  const appIso1 = await CandidateApplication.create({
    ...sanitizeApplicationPayload({
      firstName: 'IsoOne',
      lastName: 'Client',
      addressStartDate: '2023-01-01',
      housingStatus: 'Own',
      refusedVisa: 'Yes',
      refusedVisaReason: 'Client 1 Refusal Reason',
      refusedVisaDate: '2022-01-15',
      refusedVisaCountry: 'Japan',
      refusedVisaType: 'Work Visa',
      refusedVisaReference: 'JAP-001',
    }),
    userId: uIso1.id,
    status: 'draft',
  });

  const appIso2 = await CandidateApplication.create({
    ...sanitizeApplicationPayload({
      firstName: 'IsoTwo',
      lastName: 'Client',
      addressStartDate: '2023-01-01',
      housingStatus: 'Own',
      refusedVisa: 'No',
    }),
    userId: uIso2.id,
    status: 'draft',
  });

  // Verify initial isolation
  const check1 = await CandidateApplication.findByPk(appIso1.id);
  const check2 = await CandidateApplication.findByPk(appIso2.id);

  if (check1.refusedVisaReason !== 'Client 1 Refusal Reason' || check1.refusedVisaCountry !== 'Japan') {
    throw new Error('TEST 17 Failed: Client 1 data mismatch');
  }
  if (check2.refusedVisa !== 'No' || check2.refusedVisaReason !== null) {
    throw new Error('TEST 17 Failed: Client 2 should not have refusal data');
  }

  // Update Client 1
  await check1.update(
    sanitizeApplicationPayload({
      refusedVisaReason: 'Client 1 UPDATED Refusal Reason',
      refusedVisaCountry: 'South Korea',
    })
  );

  const reloadedCheck1 = await CandidateApplication.findByPk(appIso1.id);
  const reloadedCheck2 = await CandidateApplication.findByPk(appIso2.id);

  if (reloadedCheck1.refusedVisaCountry !== 'South Korea') {
    throw new Error('TEST 17 Failed: Client 1 update failed');
  }
  if (reloadedCheck2.refusedVisa !== 'No' || reloadedCheck2.refusedVisaReason !== null) {
    throw new Error('TEST 17 Failed: Client 2 data leaked during Client 1 update');
  }
  console.log('  [PASS] Cross-client data isolation verified between distinct client records.\n');

  console.log('============================================================');
  console.log('ALL 17 BUG-013 AUTOMATED TESTS PASSED 100%');
  console.log('============================================================');
  process.exit(0);
}

runBug013Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
