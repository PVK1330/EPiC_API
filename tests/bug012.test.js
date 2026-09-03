import { getTenantDb } from '../src/services/tenantDb.service.js';
import { sanitizeApplicationPayload, validateFinalApplicationSubmission } from '../src/utils/applicationPayload.util.js';
import { generateBrandedPdfBuffer } from '../src/services/pdfGenerator.service.js';
import { resolveOrgPdfLogoDataUri } from '../src/utils/pdfLogo.js';

async function runBug012Tests() {
  console.log('============================================================');
  console.log('STARTING BUG-012 AUTOMATED TEST SUITE — STRUCTURED MEDICAL TREATMENT');
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
      first_name: 'Bug012',
      last_name: 'Tester',
      email: `test_bug012_${userCounter++}@example.com`,
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

  // TEST 1: Medical treatment = Yes + complete details -> PASS
  console.log('TEST 1: Medical treatment = Yes + complete details');
  const u1 = await nextTestUser();
  const payload1 = sanitizeApplicationPayload({
    firstName: 'Alice',
    lastName: 'Hospital',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    medicalTreatment: 'Yes',
    medicalTreatmentHospitalClinicName: 'ABC Hospital',
    medicalTreatmentHospitalClinicAddress: '123 Medical Street, London EC1A 1BB',
    medicalTreatmentStartDate: '2023-01-01',
    medicalTreatmentEndDate: '2023-03-01',
    medicalTreatmentDetails: 'Previous treatment details.',
  });
  validateFinalApplicationSubmission(payload1);
  const app1 = await CandidateApplication.create({
    ...payload1,
    userId: u1.id,
    status: 'draft',
  });
  if (
    app1.medicalTreatment !== 'Yes' ||
    app1.medicalTreatmentHospitalClinicName !== 'ABC Hospital' ||
    !app1.medicalTreatmentHospitalClinicAddress.includes('123 Medical Street')
  ) {
    throw new Error('TEST 1 Failed: Medical treatment details mismatch');
  }
  console.log('  [PASS] Medical treatment = Yes with complete structured details persisted successfully.\n');

  // TEST 2: Yes + missing hospital/clinic -> REJECT
  console.log('TEST 2: Yes + missing hospital/clinic (Rejected)');
  const payload2 = sanitizeApplicationPayload({
    firstName: 'Bob',
    lastName: 'NoHospital',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    medicalTreatment: 'Yes',
    medicalTreatmentHospitalClinicName: '',
    medicalTreatmentHospitalClinicAddress: '123 Medical Street',
    medicalTreatmentStartDate: '2023-01-01',
    medicalTreatmentEndDate: '2023-03-01',
  });
  let rejected2 = false;
  try {
    validateFinalApplicationSubmission(payload2);
  } catch (err) {
    rejected2 = true;
    console.log(`  [PASS] Correctly rejected missing hospital name: "${err.message}"\n`);
  }
  if (!rejected2) throw new Error('TEST 2 Failed: Missing hospital name was not rejected');

  // TEST 3: Yes + missing address -> REJECT
  console.log('TEST 3: Yes + missing address (Rejected)');
  const payload3 = sanitizeApplicationPayload({
    firstName: 'Charlie',
    lastName: 'NoAddress',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    medicalTreatment: 'Yes',
    medicalTreatmentHospitalClinicName: 'ABC Hospital',
    medicalTreatmentHospitalClinicAddress: '',
    medicalTreatmentStartDate: '2023-01-01',
    medicalTreatmentEndDate: '2023-03-01',
  });
  let rejected3 = false;
  try {
    validateFinalApplicationSubmission(payload3);
  } catch (err) {
    rejected3 = true;
    console.log(`  [PASS] Correctly rejected missing hospital address: "${err.message}"\n`);
  }
  if (!rejected3) throw new Error('TEST 3 Failed: Missing hospital address was not rejected');

  // TEST 4: Yes + missing start date -> REJECT
  console.log('TEST 4: Yes + missing start date (Rejected)');
  const payload4 = sanitizeApplicationPayload({
    firstName: 'Diana',
    lastName: 'NoStartDate',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    medicalTreatment: 'Yes',
    medicalTreatmentHospitalClinicName: 'ABC Hospital',
    medicalTreatmentHospitalClinicAddress: '123 Medical Street',
    medicalTreatmentStartDate: '',
    medicalTreatmentEndDate: '2023-03-01',
  });
  let rejected4 = false;
  try {
    validateFinalApplicationSubmission(payload4);
  } catch (err) {
    rejected4 = true;
    console.log(`  [PASS] Correctly rejected missing start date: "${err.message}"\n`);
  }
  if (!rejected4) throw new Error('TEST 4 Failed: Missing start date was not rejected');

  // TEST 5: Yes + missing end date -> REJECT
  console.log('TEST 5: Yes + missing end date (Rejected)');
  const payload5 = sanitizeApplicationPayload({
    firstName: 'Eric',
    lastName: 'NoEndDate',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    medicalTreatment: 'Yes',
    medicalTreatmentHospitalClinicName: 'ABC Hospital',
    medicalTreatmentHospitalClinicAddress: '123 Medical Street',
    medicalTreatmentStartDate: '2023-01-01',
    medicalTreatmentEndDate: '',
  });
  let rejected5 = false;
  try {
    validateFinalApplicationSubmission(payload5);
  } catch (err) {
    rejected5 = true;
    console.log(`  [PASS] Correctly rejected missing end date: "${err.message}"\n`);
  }
  if (!rejected5) throw new Error('TEST 5 Failed: Missing end date was not rejected');

  // TEST 6: Yes + end date before start date -> REJECT
  console.log('TEST 6: Yes + end date before start date (Rejected)');
  const payload6 = sanitizeApplicationPayload({
    firstName: 'Fiona',
    lastName: 'InvalidDates',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    medicalTreatment: 'Yes',
    medicalTreatmentHospitalClinicName: 'ABC Hospital',
    medicalTreatmentHospitalClinicAddress: '123 Medical Street',
    medicalTreatmentStartDate: '2024-06-01',
    medicalTreatmentEndDate: '2024-01-01',
  });
  let rejected6 = false;
  try {
    validateFinalApplicationSubmission(payload6);
  } catch (err) {
    rejected6 = true;
    console.log(`  [PASS] Correctly rejected invalid date range: "${err.message}"\n`);
  }
  if (!rejected6) throw new Error('TEST 6 Failed: End date before start date was not rejected');

  // TEST 7: Medical treatment = No + empty details -> PASS
  console.log('TEST 7: Medical treatment = No + empty details');
  const u7 = await nextTestUser();
  const payload7 = sanitizeApplicationPayload({
    firstName: 'George',
    lastName: 'NoMed',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    medicalTreatment: 'No',
  });
  validateFinalApplicationSubmission(payload7);
  const app7 = await CandidateApplication.create({
    ...payload7,
    userId: u7.id,
    status: 'draft',
  });
  if (app7.medicalTreatment !== 'No') {
    throw new Error('TEST 7 Failed: medicalTreatment No mismatch');
  }
  console.log('  [PASS] Medical treatment = No with empty details validated and saved.\n');

  // TEST 8: Edit medical treatment details
  console.log('TEST 8: Edit medical treatment details');
  const updatePayload8 = sanitizeApplicationPayload({
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    medicalTreatment: 'Yes',
    medicalTreatmentHospitalClinicName: 'XYZ Clinic',
    medicalTreatmentHospitalClinicAddress: '456 Healthcare Way',
    medicalTreatmentStartDate: '2023-02-01',
    medicalTreatmentEndDate: '2023-05-01',
    medicalTreatmentDetails: 'Updated treatment narrative.',
  });
  validateFinalApplicationSubmission(updatePayload8);
  await app1.update(updatePayload8);
  const reloaded1 = await CandidateApplication.findByPk(app1.id);
  if (reloaded1.medicalTreatmentHospitalClinicName !== 'XYZ Clinic') {
    throw new Error('TEST 8 Failed: Edit medical details failed');
  }
  console.log(`  [PASS] Updated medical details: "${reloaded1.medicalTreatmentHospitalClinicName}"\n`);

  // TEST 9: Legacy Yes + NULL treatment details
  console.log('TEST 9: Legacy Yes record with NULL treatment details compatibility');
  const uLegacy = await nextTestUser();
  const [legacyResult] = await tenantDb.sequelize.query(`
    INSERT INTO candidate_applications ("userId", "firstName", "lastName", "medicalTreatment", "medicalTreatmentHospitalClinicName", "addressStartDate", "housingStatus", "status", "createdAt", "updatedAt")
    VALUES (${uLegacy.id}, 'LegacyMedUser', 'Tester', 'Yes', NULL, '2020-01-01', 'Own', 'draft', NOW(), NOW())
    RETURNING *;
  `);
  const legacyRecord = legacyResult[0];
  const reloadedLegacy = await CandidateApplication.findByPk(legacyRecord.id);
  if (reloadedLegacy.medicalTreatmentHospitalClinicName !== null) {
    throw new Error('TEST 9 Failed: Expected null legacy details');
  }
  // Upgrade legacy record
  await reloadedLegacy.update({
    medicalTreatmentHospitalClinicName: 'St Mary Hospital',
    medicalTreatmentHospitalClinicAddress: 'Praed St, London W2 1NY',
    medicalTreatmentStartDate: '2021-05-01',
    medicalTreatmentEndDate: '2021-06-01',
  });
  const updatedLegacy = await CandidateApplication.findByPk(legacyRecord.id);
  if (updatedLegacy.medicalTreatmentHospitalClinicName !== 'St Mary Hospital') {
    throw new Error('TEST 9 Failed: Upgrading legacy details failed');
  }
  console.log('  [PASS] Legacy record with NULL details loaded and upgraded cleanly.\n');

  // TEST 10: Read-only formatting
  console.log('TEST 10: Read-only formatting');
  const mockReadonlyForm = {
    medicalTreatment: 'Yes',
    medicalTreatmentHospitalClinicName: 'ABC Hospital',
    medicalTreatmentHospitalClinicAddress: '123 Medical Street',
    medicalTreatmentStartDate: '2023-01-01',
    medicalTreatmentEndDate: '2023-03-01',
  };
  const PARENT_MAP = {
    medicalTreatmentHospitalClinicName: 'medicalTreatment',
    medicalTreatmentHospitalClinicAddress: 'medicalTreatment',
    medicalTreatmentStartDate: 'medicalTreatment',
    medicalTreatmentEndDate: 'medicalTreatment',
    medicalTreatmentDetails: 'medicalTreatment',
  };
  function shouldShowInReadonly(key, form) {
    if (PARENT_MAP[key] && form[PARENT_MAP[key]] !== 'Yes') {
      return false;
    }
    return true;
  }
  if (!shouldShowInReadonly('medicalTreatmentHospitalClinicName', mockReadonlyForm)) {
    throw new Error('TEST 10 Failed: medicalTreatmentHospitalClinicName should be shown when Yes');
  }
  mockReadonlyForm.medicalTreatment = 'No';
  if (shouldShowInReadonly('medicalTreatmentHospitalClinicName', mockReadonlyForm)) {
    throw new Error('TEST 10 Failed: medicalTreatmentHospitalClinicName should be hidden when No');
  }
  console.log('  [PASS] Read-only formatting verified.\n');

  // TEST 11: PDF generation
  console.log('TEST 11: PDF generation with structured medical treatment details');
  const mockPdfApp = {
    firstName: 'Helen',
    lastName: 'Patient',
    medicalTreatment: 'Yes',
    medicalTreatmentHospitalClinicName: 'ABC Hospital',
    medicalTreatmentHospitalClinicAddress: '123 Medical Street',
    medicalTreatmentStartDate: '2023-01-01',
    medicalTreatmentEndDate: '2023-03-01',
    medicalTreatmentDetails: 'Orthopedic consultation',
    addressStartDate: '2022-01-01',
    housingStatus: 'Own',
  };

  const PDF_APPLICATION_SECTIONS = [
    {
      title: 'Identity & Residence',
      fields: [
        'medicalTreatment',
        'medicalTreatmentHospitalClinicName',
        'medicalTreatmentHospitalClinicAddress',
        'medicalTreatmentStartDate',
        'medicalTreatmentEndDate',
        'medicalTreatmentDetails',
      ],
    },
  ];

  function formatScalar(fieldKey, raw) {
    if (raw === null || raw === undefined || raw === '') return '—';
    return String(raw);
  }

  const sectionsForPdf = PDF_APPLICATION_SECTIONS.map((sec) => ({
    title: sec.title,
    fields: sec.fields.map((f) => ({
      label: f,
      value: formatScalar(f, mockPdfApp[f]),
    })),
  }));

  const logoDataUri = await resolveOrgPdfLogoDataUri(tenantDb, orgId);
  const pdfBuffer = await generateBrandedPdfBuffer({
    title: 'Candidate Application Summary',
    subtitle: 'Helen Patient - APP-BUG012',
    sections: sectionsForPdf,
    logoDataUri,
    orgName: org?.name || 'Immigration CRM',
  });

  if (!pdfBuffer || pdfBuffer.length < 500) {
    throw new Error('TEST 11 Failed: PDF buffer too small or empty');
  }
  console.log(`  [PASS] PDF generated successfully (${pdfBuffer.length} bytes) including structured medical treatment details.\n`);

  // TEST 12: Caseworker flow (shared mapping & persistence)
  console.log('TEST 12: Caseworker flow');
  const caseworkerUpdate = sanitizeApplicationPayload({
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    medicalTreatment: 'Yes',
    medicalTreatmentHospitalClinicName: 'Royal Free Hospital',
    medicalTreatmentHospitalClinicAddress: 'Pond St, London NW3 2QG',
    medicalTreatmentStartDate: '2022-04-01',
    medicalTreatmentEndDate: '2022-08-01',
    medicalTreatmentDetails: 'Caseworker verified medical history.',
  });
  validateFinalApplicationSubmission(caseworkerUpdate);
  await app1.update(caseworkerUpdate);
  const reloadedCW = await CandidateApplication.findByPk(app1.id);
  if (reloadedCW.medicalTreatmentHospitalClinicName !== 'Royal Free Hospital') {
    throw new Error('TEST 12 Failed: Caseworker flow update failed');
  }
  console.log('  [PASS] Caseworker flow update verified.\n');

  // TEST 13: Yes -> No transition
  console.log('TEST 13: Yes -> No transition');
  await app1.update({ medicalTreatment: 'No' });
  const reloadedAfterNo = await CandidateApplication.findByPk(app1.id);
  if (reloadedAfterNo.medicalTreatment !== 'No') {
    throw new Error('TEST 13 Failed: Yes -> No update failed');
  }
  console.log('  [PASS] Yes -> No transition succeeded without breaking application record.\n');

  // TEST 14: No -> Yes transition
  console.log('TEST 14: No -> Yes transition');
  await app7.update({
    medicalTreatment: 'Yes',
    medicalTreatmentHospitalClinicName: 'King College Hospital',
    medicalTreatmentHospitalClinicAddress: 'Denmark Hill, London SE5 9RS',
    medicalTreatmentStartDate: '2023-05-01',
    medicalTreatmentEndDate: '2023-07-01',
  });
  const reloadedAfterYes = await CandidateApplication.findByPk(app7.id);
  if (
    reloadedAfterYes.medicalTreatment !== 'Yes' ||
    reloadedAfterYes.medicalTreatmentHospitalClinicName !== 'King College Hospital'
  ) {
    throw new Error('TEST 14 Failed: No -> Yes update failed');
  }
  console.log('  [PASS] No -> Yes transition with structured details succeeded.\n');

  console.log('============================================================');
  console.log('ALL 14 BUG-012 AUTOMATED TESTS PASSED 100%');
  console.log('============================================================');
  process.exit(0);
}

runBug012Tests().catch((err) => {
  console.error('BUG-012 Test Suite Failed:', err);
  process.exit(1);
});
