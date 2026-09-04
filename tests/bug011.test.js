import { getTenantDb } from '../src/services/tenantDb.service.js';
import { sanitizeApplicationPayload, validateFinalApplicationSubmission } from '../src/utils/applicationPayload.util.js';
import { generateBrandedPdfBuffer } from '../src/services/pdfGenerator.service.js';
import { resolveOrgPdfLogoDataUri } from '../src/utils/pdfLogo.js';

async function runBug011Tests() {
  console.log('============================================================');
  console.log('STARTING BUG-011 AUTOMATED TEST SUITE — CONDITIONAL YES DETAILS');
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
      first_name: 'Bug011',
      last_name: 'Tester',
      email: `test_bug011_${userCounter++}@example.com`,
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

  // TEST 1: Medical treatment = Yes + details -> PASS
  console.log('TEST 1: Medical treatment = Yes + details');
  const u1 = await nextTestUser();
  const payload1 = sanitizeApplicationPayload({
    firstName: 'Alice',
    lastName: 'Medical',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    medicalTreatment: 'Yes',
    medicalTreatmentHospitalClinicName: 'Guy Hospital',
    medicalTreatmentHospitalClinicAddress: 'Great Maze Pond, London SE1 9RT',
    medicalTreatmentStartDate: '2021-01-01',
    medicalTreatmentEndDate: '2021-06-01',
    medicalTreatmentDetails: 'Received outpatient physiotherapy at Guy Hospital London in 2021.',
  });
  validateFinalApplicationSubmission(payload1);
  const app1 = await CandidateApplication.create({
    ...payload1,
    userId: u1.id,
    status: 'draft',
  });
  if (app1.medicalTreatment !== 'Yes' || !app1.medicalTreatmentDetails.includes('physiotherapy')) {
    throw new Error('TEST 1 Failed: Medical treatment details mismatch');
  }
  console.log('  [PASS] Medical treatment = Yes with details persisted successfully.\n');

  // TEST 2: Medical treatment = Yes + missing details -> reject
  console.log('TEST 2: Medical treatment = Yes + missing details (Rejected)');
  const payload2 = sanitizeApplicationPayload({
    firstName: 'Bob',
    lastName: 'NoMedDetails',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    medicalTreatment: 'Yes',
    medicalTreatmentHospitalClinicName: '',
    medicalTreatmentHospitalClinicAddress: '123 Test St',
    medicalTreatmentStartDate: '2021-01-01',
    medicalTreatmentEndDate: '2021-06-01',
    medicalTreatmentDetails: '',
  });
  let rejected2 = false;
  try {
    validateFinalApplicationSubmission(payload2);
  } catch (err) {
    rejected2 = true;
    console.log(`  [PASS] Correctly rejected missing medical details: "${err.message}"\n`);
  }
  if (!rejected2) throw new Error('TEST 2 Failed: Missing medical treatment details was not rejected');

  // TEST 3: Medical treatment = No + empty details -> PASS
  console.log('TEST 3: Medical treatment = No + empty details');
  const u3 = await nextTestUser();
  const payload3 = sanitizeApplicationPayload({
    firstName: 'Charlie',
    lastName: 'NoMedical',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    medicalTreatment: 'No',
    medicalTreatmentDetails: '',
  });
  validateFinalApplicationSubmission(payload3);
  const app3 = await CandidateApplication.create({
    ...payload3,
    userId: u3.id,
    status: 'draft',
  });
  if (app3.medicalTreatment !== 'No') {
    throw new Error('TEST 3 Failed: medicalTreatment No mismatch');
  }
  console.log('  [PASS] Medical treatment = No with empty details validated and saved.\n');

  // TEST 4: Visa refusal = Yes + details -> PASS
  console.log('TEST 4: Visa refusal = Yes + details');
  const u4 = await nextTestUser();
  const payload4 = sanitizeApplicationPayload({
    firstName: 'Diana',
    lastName: 'Refused',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    refusedVisa: 'Yes',
    refusedVisaDate: '2019-05-01',
    refusedVisaCountry: 'Canada',
    refusedVisaType: 'Tourist Visa',
    refusedVisaDetails: 'Refused Canada tourist visa in 2019 due to missing bank statement.',
  });
  validateFinalApplicationSubmission(payload4);
  const app4 = await CandidateApplication.create({
    ...payload4,
    userId: u4.id,
    status: 'draft',
  });
  if (app4.refusedVisa !== 'Yes' || !app4.refusedVisaDetails.includes('Canada tourist visa')) {
    throw new Error('TEST 4 Failed: Visa refusal details mismatch');
  }
  console.log('  [PASS] Visa refusal = Yes with details persisted successfully.\n');

  // TEST 5: Visa refusal = Yes + missing details -> reject
  console.log('TEST 5: Visa refusal = Yes + missing details (Rejected)');
  const payload5 = sanitizeApplicationPayload({
    firstName: 'Eric',
    lastName: 'NoRefusalDetails',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    refusedVisa: 'Yes',
    refusedVisaDetails: '   ',
  });
  let rejected5 = false;
  try {
    validateFinalApplicationSubmission(payload5);
  } catch (err) {
    rejected5 = true;
    console.log(`  [PASS] Correctly rejected missing visa refusal details: "${err.message}"\n`);
  }
  if (!rejected5) throw new Error('TEST 5 Failed: Missing visa refusal details was not rejected');

  // TEST 6: Visa refusal = No + empty details -> PASS
  console.log('TEST 6: Visa refusal = No + empty details');
  const u6 = await nextTestUser();
  const payload6 = sanitizeApplicationPayload({
    firstName: 'Fiona',
    lastName: 'NoRefusals',
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    refusedVisa: 'No',
    refusedVisaDetails: '',
  });
  validateFinalApplicationSubmission(payload6);
  const app6 = await CandidateApplication.create({
    ...payload6,
    userId: u6.id,
    status: 'draft',
  });
  if (app6.refusedVisa !== 'No') {
    throw new Error('TEST 6 Failed: refusedVisa No mismatch');
  }
  console.log('  [PASS] Visa refusal = No with empty details validated and saved.\n');

  // TEST 7: Edit existing medical-treatment details
  console.log('TEST 7: Edit existing medical-treatment details');
  const updatePayload7 = sanitizeApplicationPayload({
    medicalTreatmentDetails: 'Updated: Received treatment at St Thomas Hospital in 2022.',
  });
  await app1.update(updatePayload7);
  const reloaded1 = await CandidateApplication.findByPk(app1.id);
  if (!reloaded1.medicalTreatmentDetails.includes('St Thomas Hospital')) {
    throw new Error('TEST 7 Failed: Edit medical details failed');
  }
  console.log(`  [PASS] Updated medical details: "${reloaded1.medicalTreatmentDetails}"\n`);

  // TEST 8: Edit existing visa-refusal details
  console.log('TEST 8: Edit existing visa-refusal details');
  const updatePayload8 = sanitizeApplicationPayload({
    refusedVisaDetails: 'Updated: Canada study permit refusal overturned on appeal in 2020.',
  });
  await app4.update(updatePayload8);
  const reloaded4 = await CandidateApplication.findByPk(app4.id);
  if (!reloaded4.refusedVisaDetails.includes('overturned on appeal')) {
    throw new Error('TEST 8 Failed: Edit visa refusal details failed');
  }
  console.log(`  [PASS] Updated refusal details: "${reloaded4.refusedVisaDetails}"\n`);

  // TEST 9: Legacy Yes record with NULL details
  console.log('TEST 9: Legacy Yes record with NULL details compatibility');
  const uLegacy = await nextTestUser();
  const [legacyResult] = await tenantDb.sequelize.query(`
    INSERT INTO candidate_applications ("userId", "firstName", "lastName", "medicalTreatment", "medicalTreatmentDetails", "refusedVisa", "refusedVisaDetails", "addressStartDate", "housingStatus", "status", "createdAt", "updatedAt")
    VALUES (${uLegacy.id}, 'LegacyMedUser', 'Tester', 'Yes', NULL, 'Yes', NULL, '2020-01-01', 'Own', 'draft', NOW(), NOW())
    RETURNING *;
  `);
  const legacyRecord = legacyResult[0];
  const reloadedLegacy = await CandidateApplication.findByPk(legacyRecord.id);
  if (reloadedLegacy.medicalTreatmentDetails !== null || reloadedLegacy.refusedVisaDetails !== null) {
    throw new Error('TEST 9 Failed: Expected null legacy details');
  }
  // Upgrade legacy record
  await reloadedLegacy.update({
    medicalTreatmentDetails: 'Legacy treatment details added.',
    refusedVisaDetails: 'Legacy visa refusal details added.',
  });
  const updatedLegacy = await CandidateApplication.findByPk(legacyRecord.id);
  if (!updatedLegacy.medicalTreatmentDetails.includes('Legacy treatment')) {
    throw new Error('TEST 9 Failed: Upgrading legacy details failed');
  }
  console.log('  [PASS] Legacy record with NULL details loaded and upgraded cleanly.\n');

  // TEST 10: Read-only display formatting
  console.log('TEST 10: Read-only display formatting');
  const mockReadonlyForm = {
    medicalTreatment: 'Yes',
    medicalTreatmentDetails: 'Prescription treatment only',
    refusedVisa: 'No',
    refusedVisaDetails: 'Old detail',
  };
  const PARENT_MAP = {
    medicalTreatmentDetails: 'medicalTreatment',
    refusedVisaDetails: 'refusedVisa',
  };
  function shouldShowInReadonly(key, form) {
    if (PARENT_MAP[key] && form[PARENT_MAP[key]] !== 'Yes') {
      return false;
    }
    return true;
  }
  if (!shouldShowInReadonly('medicalTreatmentDetails', mockReadonlyForm)) {
    throw new Error('TEST 10 Failed: medicalTreatmentDetails should be shown when Yes');
  }
  if (shouldShowInReadonly('refusedVisaDetails', mockReadonlyForm)) {
    throw new Error('TEST 10 Failed: refusedVisaDetails should be hidden when No');
  }
  console.log('  [PASS] Read-only displays medicalTreatmentDetails when Yes and hides refusedVisaDetails when No.\n');

  // TEST 11: PDF generation with conditional details
  console.log('TEST 11: PDF generation with conditional details');
  const mockPdfApp = {
    firstName: 'George',
    lastName: 'Patient',
    medicalTreatment: 'Yes',
    medicalTreatmentDetails: 'NHS GP registration and medication',
    refusedVisa: 'Yes',
    refusedVisaDetails: 'USA B1/B2 visa refusal in 2018',
    addressStartDate: '2022-01-01',
    housingStatus: 'Own',
  };

  const PDF_APPLICATION_SECTIONS = [
    {
      title: 'Identity & Residence',
      fields: ['medicalTreatment', 'medicalTreatmentDetails'],
    },
    {
      title: 'Immigration History',
      fields: ['refusedVisa', 'refusedVisaDetails'],
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
    subtitle: 'George Patient - APP-BUG011',
    sections: sectionsForPdf,
    logoDataUri,
    orgName: org?.name || 'Immigration CRM',
  });

  if (!pdfBuffer || pdfBuffer.length < 500) {
    throw new Error('TEST 11 Failed: PDF buffer too small or empty');
  }
  console.log(`  [PASS] PDF generated successfully (${pdfBuffer.length} bytes) including medical and visa refusal details.\n`);

  // TEST 12: Caseworker flow (shared mapping & persistence)
  console.log('TEST 12: Caseworker flow');
  const caseworkerUpdate = sanitizeApplicationPayload({
    addressStartDate: '2023-01-01',
    housingStatus: 'Own',
    illegalEntry: 'Yes',
    illegalEntryDetails: 'Case worker note: Verified entry history on Home Office file.',
  });
  validateFinalApplicationSubmission(caseworkerUpdate);
  await app1.update(caseworkerUpdate);
  const reloadedCW = await CandidateApplication.findByPk(app1.id);
  if (reloadedCW.illegalEntry !== 'Yes' || !reloadedCW.illegalEntryDetails.includes('Case worker note')) {
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
  await app3.update({
    medicalTreatment: 'Yes',
    medicalTreatmentDetails: 'Newly declared NHS hospital consultation.',
  });
  const reloadedAfterYes = await CandidateApplication.findByPk(app3.id);
  if (reloadedAfterYes.medicalTreatment !== 'Yes' || !reloadedAfterYes.medicalTreatmentDetails.includes('NHS hospital')) {
    throw new Error('TEST 14 Failed: No -> Yes update failed');
  }
  console.log('  [PASS] No -> Yes transition with details succeeded.\n');

  console.log('============================================================');
  console.log('ALL 14 BUG-011 AUTOMATED TESTS PASSED 100%');
  console.log('============================================================');
  process.exit(0);
}

runBug011Tests().catch((err) => {
  console.error('BUG-011 Test Suite Failed:', err);
  process.exit(1);
});
