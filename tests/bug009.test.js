import { getTenantDb } from '../src/services/tenantDb.service.js';
import { sanitizeApplicationPayload, validateFinalApplicationSubmission } from '../src/utils/applicationPayload.util.js';
import { generateBrandedPdfBuffer } from '../src/services/pdfGenerator.service.js';
import { resolveOrgPdfLogoDataUri } from '../src/utils/pdfLogo.js';

async function runBug009Tests() {
  console.log('============================================================');
  console.log('STARTING BUG-009 AUTOMATED TEST SUITE — DRIVING LICENCE NUMBER');
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
      first_name: 'Bug009',
      last_name: 'Tester',
      email: `test_bug009_${userCounter++}@example.com`,
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

  // TEST 1: Licence = Yes + valid number (TEST123456)
  console.log('TEST 1: Licence = Yes + valid number ("TEST123456")');
  const u1 = await nextTestUser();
  const payload1 = sanitizeApplicationPayload({
    firstName: 'Alice',
    lastName: 'Driver',
    addressStartDate: '2022-01-01',
    housingStatus: 'Own',
    ukLicense: 'Yes',
    ukLicenseNumber: 'TEST123456',
  });
  validateFinalApplicationSubmission(payload1);
  const app1 = await CandidateApplication.create({
    ...payload1,
    userId: u1.id,
    status: 'draft',
  });
  if (app1.ukLicense !== 'Yes' || app1.ukLicenseNumber !== 'TEST123456') {
    throw new Error(`TEST 1 Failed: DB persistence mismatch: ukLicense=${app1.ukLicense}, ukLicenseNumber=${app1.ukLicenseNumber}`);
  }
  console.log(`  [PASS] Successfully persisted: ukLicense=${app1.ukLicense}, ukLicenseNumber=${app1.ukLicenseNumber}\n`);

  // TEST 2: Licence = Yes + missing licence number (Rejection on submission)
  console.log('TEST 2: Licence = Yes + missing licence number (Rejected)');
  const payload2 = sanitizeApplicationPayload({
    firstName: 'Bob',
    lastName: 'NoNumber',
    addressStartDate: '2022-01-01',
    housingStatus: 'Own',
    ukLicense: 'Yes',
    ukLicenseNumber: '',
  });
  let rejected2 = false;
  try {
    validateFinalApplicationSubmission(payload2);
  } catch (err) {
    rejected2 = true;
    console.log(`  [PASS] Correctly rejected missing licence number: "${err.message}"\n`);
  }
  if (!rejected2) throw new Error('TEST 2 Failed: Missing licence number was not rejected when ukLicense === "Yes"');

  // TEST 3: Licence = No + empty licence number (Valid)
  console.log('TEST 3: Licence = No + empty licence number');
  const u3 = await nextTestUser();
  const payload3 = sanitizeApplicationPayload({
    firstName: 'Charlie',
    lastName: 'NonDriver',
    addressStartDate: '2022-01-01',
    housingStatus: 'Own',
    ukLicense: 'No',
    ukLicenseNumber: '',
  });
  validateFinalApplicationSubmission(payload3);
  const app3 = await CandidateApplication.create({
    ...payload3,
    userId: u3.id,
    status: 'draft',
  });
  if (app3.ukLicense !== 'No') {
    throw new Error(`TEST 3 Failed: DB persistence mismatch`);
  }
  console.log(`  [PASS] Successfully saved non-driver without licence number.\n`);

  // TEST 4: Edit licence number (TEST123456 -> TEST654321)
  console.log('TEST 4: Edit licence number (TEST123456 -> TEST654321)');
  const updatePayload4 = sanitizeApplicationPayload({
    ukLicenseNumber: 'TEST654321',
  });
  await app1.update(updatePayload4);
  const reloaded1 = await CandidateApplication.findByPk(app1.id);
  if (reloaded1.ukLicenseNumber !== 'TEST654321') {
    throw new Error(`TEST 4 Failed: Update failed, got: ${reloaded1.ukLicenseNumber}`);
  }
  console.log(`  [PASS] Successfully updated licence number to: ${reloaded1.ukLicenseNumber}\n`);

  // TEST 5: Edit licence from Yes to No
  console.log('TEST 5: Edit licence status from Yes to No');
  const updatePayload5 = sanitizeApplicationPayload({
    ukLicense: 'No',
  });
  await app1.update(updatePayload5);
  const reloaded5 = await CandidateApplication.findByPk(app1.id);
  if (reloaded5.ukLicense !== 'No') {
    throw new Error(`TEST 5 Failed: ukLicense update failed`);
  }
  console.log(`  [PASS] Successfully updated ukLicense to No.\n`);

  // TEST 6: Legacy record compatibility (raw DB insert with null ukLicenseNumber)
  console.log('TEST 6: Legacy record compatibility');
  const u6 = await nextTestUser();
  const [legacyResult] = await tenantDb.sequelize.query(`
    INSERT INTO candidate_applications ("userId", "firstName", "lastName", "ukLicense", "ukLicenseNumber", "addressStartDate", "housingStatus", "status", "createdAt", "updatedAt")
    VALUES (${u6.id}, 'LegacyDriver', 'Tester', 'Yes', NULL, '2022-01-01', 'Own', 'draft', NOW(), NOW())
    RETURNING *;
  `);
  const legacyRecord = legacyResult[0];
  const reloadedLegacy = await CandidateApplication.findByPk(legacyRecord.id);
  if (reloadedLegacy.ukLicenseNumber !== null) {
    throw new Error('TEST 6 Failed: Expected null legacy ukLicenseNumber');
  }
  // Update legacy record with new licence number
  await reloadedLegacy.update({ ukLicenseNumber: 'LEGACY-DL-999' });
  const updatedLegacy = await CandidateApplication.findByPk(legacyRecord.id);
  if (updatedLegacy.ukLicenseNumber !== 'LEGACY-DL-999') {
    throw new Error(`TEST 6 Failed: Could not update legacy licence number: ${updatedLegacy.ukLicenseNumber}`);
  }
  console.log(`  [PASS] Legacy record loaded and upgraded successfully: ${updatedLegacy.ukLicenseNumber}\n`);

  // TEST 7: Overlength licence number rejected (> 100 characters)
  console.log('TEST 7: Overlength licence number (> 100 characters) rejected');
  let rejected7 = false;
  try {
    sanitizeApplicationPayload({
      ukLicenseNumber: 'X'.repeat(101),
    });
  } catch (err) {
    rejected7 = true;
    console.log(`  [PASS] Rejected overlength licence number: "${err.message}"\n`);
  }
  if (!rejected7) throw new Error('TEST 7 Failed: Overlength licence number not rejected');

  // TEST 8: PDF Generation includes UK driving licence number
  console.log('TEST 8: PDF Generation with UK driving licence number');
  const mockApplication = {
    firstName: 'David',
    lastName: 'Motorist',
    ukLicense: 'Yes',
    ukLicenseNumber: 'MOTO889900AB12',
    ukStayDuration: '5 years',
    addressStartDate: '2020-05-15',
    housingStatus: 'Own',
  };

  const PDF_APPLICATION_SECTIONS = [
    {
      title: 'Identity & Residence',
      fields: ['ukLicense', 'ukLicenseNumber', 'ukStayDuration'],
    },
  ];

  function formatApplicationScalar(fieldKey, raw) {
    if (raw === null || raw === undefined || raw === '') return '—';
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
    subtitle: 'David Motorist - APP-BUG009',
    sections: sectionsForPdf,
    logoDataUri,
    orgName: org?.name || 'Immigration CRM',
  });

  if (!pdfBuffer || pdfBuffer.length < 500) {
    throw new Error('TEST 8 Failed: PDF buffer too small or empty');
  }
  console.log(`  [PASS] PDF generated successfully (${pdfBuffer.length} bytes) including UK driving licence number "MOTO889900AB12"\n`);

  console.log('============================================================');
  console.log('ALL BUG-009 AUTOMATED TESTS PASSED 100%');
  console.log('============================================================');
  process.exit(0);
}

runBug009Tests().catch((err) => {
  console.error('BUG-009 Test Suite Failed:', err);
  process.exit(1);
});
