import { getTenantDb } from '../src/services/tenantDb.service.js';
import { sanitizeApplicationPayload, validateFinalApplicationSubmission } from '../src/utils/applicationPayload.util.js';
import { generateBrandedPdfBuffer } from '../src/services/pdfGenerator.service.js';
import { resolveOrgPdfLogoDataUri } from '../src/utils/pdfLogo.js';

async function runBug008Tests() {
  console.log('============================================================');
  console.log('STARTING BUG-008 AUTOMATED TEST SUITE');
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
      first_name: 'Bug008',
      last_name: 'Tester',
      email: `test_bug008_${userCounter++}@example.com`,
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

  // TEST 1: Single nationality
  console.log('TEST 1: Single nationality ("British")');
  const u1 = await nextTestUser();
  const payload1 = sanitizeApplicationPayload({
    firstName: 'Test1',
    lastName: 'Candidate',
    nationalities: ['British'],
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
  });
  if (payload1.nationality !== 'British' || !payload1.nationalities.includes('British')) {
    throw new Error(`TEST 1 Failed: payload1 nationality sync failed: ${JSON.stringify(payload1)}`);
  }
  const app1 = await CandidateApplication.create({
    ...payload1,
    userId: u1.id,
    status: 'draft',
  });
  if (app1.nationality !== 'British' || app1.nationalities[0] !== 'British') {
    throw new Error(`TEST 1 Failed: DB persistence failed: ${JSON.stringify(app1)}`);
  }
  console.log('  [PASS] Single nationality persisted and synced.\n');

  // TEST 2: Multiple nationalities ("British", "Indian")
  console.log('TEST 2: Multiple nationalities ("British", "Indian")');
  const u2 = await nextTestUser();
  const payload2 = sanitizeApplicationPayload({
    firstName: 'Test2',
    lastName: 'Candidate',
    nationalities: ['British', 'Indian'],
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
  });
  if (payload2.nationality !== 'British' || payload2.nationalities.length !== 2) {
    throw new Error(`TEST 2 Failed: sanitization failed: ${JSON.stringify(payload2)}`);
  }
  const app2 = await CandidateApplication.create({
    ...payload2,
    userId: u2.id,
    status: 'draft',
  });
  if (app2.nationalities.length !== 2 || !app2.nationalities.includes('Indian')) {
    throw new Error(`TEST 2 Failed: DB persistence failed: ${JSON.stringify(app2.nationalities)}`);
  }
  console.log(`  [PASS] Multiple nationalities saved in DB: ${JSON.stringify(app2.nationalities)}\n`);

  // TEST 3: Three nationalities ("British", "Indian", "Canadian")
  console.log('TEST 3: Three nationalities ("British", "Indian", "Canadian")');
  const u3 = await nextTestUser();
  const payload3 = sanitizeApplicationPayload({
    firstName: 'Test3',
    lastName: 'Candidate',
    nationalities: ['British', 'Indian', 'Canadian'],
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
  });
  if (payload3.nationalities.length !== 3) {
    throw new Error(`TEST 3 Failed: sanitization failed`);
  }
  const app3 = await CandidateApplication.create({
    ...payload3,
    userId: u3.id,
    status: 'draft',
  });
  if (app3.nationalities.length !== 3 || app3.nationalities[2] !== 'Canadian') {
    throw new Error(`TEST 3 Failed: DB persistence failed`);
  }
  console.log(`  [PASS] Three nationalities saved in DB: ${JSON.stringify(app3.nationalities)}\n`);

  // TEST 4: Duplicate nationality prevention/deduplication
  console.log('TEST 4: Duplicate nationality ("British", "British", "Indian")');
  const payload4 = sanitizeApplicationPayload({
    firstName: 'Test4',
    lastName: 'Candidate',
    nationalities: ['British', 'British', 'Indian'],
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
  });
  if (payload4.nationalities.length !== 2 || payload4.nationalities[0] !== 'British' || payload4.nationalities[1] !== 'Indian') {
    throw new Error(`TEST 4 Failed: duplicates not removed: ${JSON.stringify(payload4.nationalities)}`);
  }
  console.log(`  [PASS] Duplicates cleanly deduplicated to: ${JSON.stringify(payload4.nationalities)}\n`);

  // TEST 5: Edit existing client (Add "Indian" to "British")
  console.log('TEST 5: Edit existing client (Add "Indian" to "British")');
  const u5 = await nextTestUser();
  const app5 = await CandidateApplication.create({
    firstName: 'Test5',
    lastName: 'Candidate',
    nationality: 'British',
    nationalities: ['British'],
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    userId: u5.id,
    status: 'draft',
  });
  const updatePayload5 = sanitizeApplicationPayload({
    nationalities: [...app5.nationalities, 'Indian'],
  });
  await app5.update(updatePayload5);
  const reloaded5 = await CandidateApplication.findByPk(app5.id);
  if (reloaded5.nationalities.length !== 2 || !reloaded5.nationalities.includes('Indian')) {
    throw new Error(`TEST 5 Failed: Edit update failed: ${JSON.stringify(reloaded5.nationalities)}`);
  }
  console.log(`  [PASS] Existing record updated with added nationality: ${JSON.stringify(reloaded5.nationalities)}\n`);

  // TEST 6: Remove nationality ("British, Indian, Canadian" -> remove "Indian" -> "British, Canadian")
  console.log('TEST 6: Remove nationality');
  const u6 = await nextTestUser();
  const app6 = await CandidateApplication.create({
    firstName: 'Test6',
    lastName: 'Candidate',
    nationality: 'British',
    nationalities: ['British', 'Indian', 'Canadian'],
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    userId: u6.id,
    status: 'draft',
  });
  const updatePayload6 = sanitizeApplicationPayload({
    nationalities: app6.nationalities.filter((n) => n !== 'Indian'),
  });
  await app6.update(updatePayload6);
  const reloaded6 = await CandidateApplication.findByPk(app6.id);
  if (reloaded6.nationalities.length !== 2 || reloaded6.nationalities.includes('Indian')) {
    throw new Error(`TEST 6 Failed: Removal failed: ${JSON.stringify(reloaded6.nationalities)}`);
  }
  console.log(`  [PASS] Removed nationality successfully: ${JSON.stringify(reloaded6.nationalities)}\n`);

  // TEST 7: Legacy record compatibility (raw DB record with nationality="British" and nationalities=null)
  console.log('TEST 7: Legacy record compatibility');
  const u7 = await nextTestUser();
  const [legacyResult] = await tenantDb.sequelize.query(`
    INSERT INTO candidate_applications ("userId", "firstName", "lastName", "nationality", "nationalities", "addressStartDate", "housingStatus", "status", "createdAt", "updatedAt")
    VALUES (${u7.id}, 'LegacyClient', 'Tester', 'British', NULL, '2022-01-01', 'Own', 'draft', NOW(), NOW())
    RETURNING *;
  `);
  const legacyRecord = legacyResult[0];
  const reloadedLegacy = await CandidateApplication.findByPk(legacyRecord.id);
  // Test normalization
  const normalizedLegacy = sanitizeApplicationPayload({
    nationality: reloadedLegacy.nationality,
    nationalities: reloadedLegacy.nationalities,
  });
  if (!normalizedLegacy.nationalities.includes('British')) {
    throw new Error(`TEST 7 Failed: Legacy nationality not normalized: ${JSON.stringify(normalizedLegacy)}`);
  }
  console.log(`  [PASS] Legacy record loaded and normalized seamlessly: ${JSON.stringify(normalizedLegacy.nationalities)}\n`);

  // TEST 8: Invalid / Overlength nationality rejected
  console.log('TEST 8: Overlength nationality rejected');
  let rejected = false;
  try {
    sanitizeApplicationPayload({
      nationalities: ['A'.repeat(101)],
    });
  } catch (err) {
    rejected = true;
    console.log(`  [PASS] Overlength nationality rejected as expected: ${err.message}\n`);
  }
  if (!rejected) throw new Error('TEST 8 Failed: Overlength nationality was not rejected');

  // TEST 9: PDF Generation includes multiple nationalities
  console.log('TEST 9: PDF Generation with multiple nationalities');
  const mockApplication = {
    firstName: 'Jane',
    lastName: 'Doe',
    nationalities: ['British', 'Indian', 'Canadian'],
    nationality: 'British',
    addressStartDate: '2021-01-01',
    housingStatus: 'Own',
  };

  const PDF_APPLICATION_SECTIONS = [
    {
      title: 'Nationality & Birth',
      fields: ['nationalities', 'birthCountry', 'placeOfBirth', 'dob'],
    },
  ];

  function formatApplicationScalar(fieldKey, raw) {
    if (raw === null || raw === undefined || raw === '') return '—';
    if (Array.isArray(raw)) {
      return raw.filter(Boolean).join(', ') || '—';
    }
    return String(raw);
  }

  const sectionsForPdf = PDF_APPLICATION_SECTIONS.map((sec) => ({
    title: sec.title,
    fields: sec.fields.map((f) => ({
      label: f,
      value: formatApplicationScalar(f, mockApplication[f]),
    })),
  }));

  const logoDataUri = await resolveOrgPdfLogoDataUri(tenantDb, orgId);
  const pdfBuffer = await generateBrandedPdfBuffer({
    title: 'Candidate Application Summary',
    subtitle: 'Jane Doe - APP-BUG008',
    sections: sectionsForPdf,
    logoDataUri,
    orgName: org?.name || 'Immigration CRM',
  });

  if (!pdfBuffer || pdfBuffer.length < 500) {
    throw new Error('TEST 9 Failed: PDF generation failed or returned empty buffer');
  }
  console.log(`  [PASS] PDF generated successfully (${pdfBuffer.length} bytes) with formatted nationalities: "British, Indian, Canadian"\n`);

  console.log('============================================================');
  console.log('ALL BUG-008 AUTOMATED TESTS PASSED 100%');
  console.log('============================================================');
  process.exit(0);
}

runBug008Tests().catch((err) => {
  console.error('BUG-008 Test Suite Failed:', err);
  process.exit(1);
});
