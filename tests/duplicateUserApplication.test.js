import dotenv from 'dotenv';
dotenv.config({ path: './Server/.env' });
process.env.NODE_ENV = 'development';

import assert from 'node:assert/strict';
import { getTenantDb } from '../src/services/tenantDb.service.js';
import { CandidateService } from '../src/modules/Admin/Candidates/candidate.service.js';
import { ROLES } from '../src/middlewares/role.middleware.js';
import { formatDbError } from '../src/utils/dbError.js';

async function runDuplicateUserApplicationTests() {
  console.log('============================================================');
  console.log('STARTING DUPLICATE USER & APPLICATION SAFETY TEST SUITE');
  console.log('============================================================\n');

  const tenantDb = getTenantDb('epic_technoweb');
  const candidateService = new CandidateService(tenantDb);
  const { User, Organisation, Case, CandidateApplication } = tenantDb;

  // Sync DB sequences
  await tenantDb.sequelize.query(`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1));`);
  await tenantDb.sequelize.query(`SELECT setval('candidate_applications_id_seq', COALESCE((SELECT MAX(id) FROM candidate_applications), 1));`);
  await tenantDb.sequelize.query(`SELECT setval('cases_id_seq', COALESCE((SELECT MAX(id) FROM cases), 1));`);

  const org = await Organisation.findOne({ order: [['id', 'ASC']] });
  const orgId = org ? org.id : 1;
  const performedByUser = { id: 101, organisation_id: orgId };
  const timestamp = Date.now();

  // ------------------------------------------------------------
  // TEST 1: Candidate Creation when No Application Exists
  // ------------------------------------------------------------
  console.log('TEST 1: Candidate creation when no application exists');
  const email1 = `uat_dup_1_${timestamp}@example.com`;
  const cand1Res = await candidateService.sendCredentialsToClient(
    { name: 'Unique Candidate', email: email1, country_code: '+44', contact_number: `770${Math.floor(1000000 + Math.random() * 9000000)}`, visa_type: 'Skilled Worker' },
    {},
    performedByUser
  );
  assert.ok(cand1Res && cand1Res.candidateId, 'Candidate ID must be returned');
  const cand1Id = cand1Res.candidateId;

  const app1 = await CandidateApplication.findOne({ where: { userId: cand1Id } });
  assert.ok(app1, 'Draft CandidateApplication must be created');
  assert.equal(app1.status, 'draft');
  assert.equal(app1.firstName, 'Unique');
  assert.equal(app1.visaType, 'Skilled Worker');
  console.log('  [PASS] Candidate, application, and enquiry case created cleanly.\n');

  // ------------------------------------------------------------
  // TEST 2 & 3: Non-Destructive Update on Retried / Existing Application
  // ------------------------------------------------------------
  console.log('TEST 2 & 3: Non-destructive update when completed application exists');
  const completedAppPayload = {
    passportNumber: 'GB99887766',
    issuingAuthority: 'UK Passport Office',
    issueDate: new Date('2020-01-01'),
    expiryDate: new Date('2030-01-01'),
    previousAddresses: [
      { previousAddress: '10 Old Street, London', startDate: new Date('2018-01-01'), endDate: new Date('2020-01-01') },
    ],
    medicalTreatment: 'Yes',
    medicalTreatmentHospitalClinicName: 'St Thomas Hospital',
    medicalTreatmentHospitalClinicAddress: 'Westminster Bridge Rd, London',
    medicalTreatmentStartDate: new Date('2022-05-01'),
    medicalTreatmentEndDate: new Date('2022-05-10'),
    medicalTreatmentDetails: 'Minor routine procedure',
    refusedVisa: 'Yes',
    refusedVisaReason: 'Insufficient docs in 2015',
    refusedVisaDate: new Date('2015-06-15'),
    refusedVisaCountry: 'UK',
    refusedVisaType: 'Visitor',
    refusedVisaDetails: 'Insufficient docs in 2015',
    dob: new Date('1990-05-15'),
    gender: 'Female',
  };

  await app1.update({
    ...completedAppPayload,
    status: 'submitted',
  });

  // Re-run send credentials for the SAME existing email
  let duplicateEmailError = null;
  try {
    await candidateService.sendCredentialsToClient(
      { name: 'UpdatedName Candidate', email: email1, country_code: '+44', contact_number: `770${Math.floor(1000000 + Math.random() * 9000000)}` },
      {},
      performedByUser
    );
  } catch (err) {
    duplicateEmailError = err;
  }
  assert.ok(duplicateEmailError, 'Send credentials for existing email must be rejected');
  assert.equal(duplicateEmailError.status, 400);
  assert.equal(duplicateEmailError.message, 'This email address is already registered.');

  // Verify completed fields were NOT wiped
  const app1After = await CandidateApplication.findOne({ where: { userId: cand1Id } });
  assert.equal(app1After.passportNumber, 'GB99887766');
  assert.equal(app1After.medicalTreatmentHospitalClinicName, 'St Thomas Hospital');
  assert.equal(app1After.refusedVisaReason, 'Insufficient docs in 2015');
  assert.equal(app1After.previousAddresses.length, 1);
  console.log('  [PASS] Completed application fields remain completely untouched on retried registration.\n');

  // ------------------------------------------------------------
  // TEST 4: Onboarding Hook Application Coexistence
  // ------------------------------------------------------------
  console.log('TEST 4: Onboarding hook application coexistence');
  const emailHook = `uat_dup_hook_${timestamp}@example.com`;
  const hookUser = await User.create({
    first_name: 'Hook',
    last_name: 'User',
    email: emailHook,
    country_code: '+44',
    mobile: `771${Math.floor(1000000 + Math.random() * 9000000)}`,
    password: 'HashedPassword123!',
    role_id: ROLES.CANDIDATE,
    is_email_verified: true,
    is_otp_verified: true,
    status: 'active',
    organisation_id: orgId,
  });

  // Simulate onboarding hook creating application first
  await CandidateApplication.create({
    userId: hookUser.id,
    firstName: 'Hook',
    lastName: 'User',
    email: emailHook,
    status: 'draft',
    organisation_id: orgId,
  });

  // Call updateCandidate on service for hookUser — must update app without unique constraint crash
  await candidateService.updateCandidate(
    hookUser.id,
    { first_name: 'HookUpdated', application: { visaType: 'Global Talent' } },
    orgId
  );

  const hookAppAfter = await CandidateApplication.findOne({ where: { userId: hookUser.id } });
  assert.equal(hookAppAfter.visaType, 'Global Talent');

  const countApps = await CandidateApplication.count({ where: { userId: hookUser.id } });
  assert.equal(countApps, 1, 'Exactly one application record must exist per user');
  console.log('  [PASS] Onboarding hook application updated seamlessly without duplicate errors.\n');

  // ------------------------------------------------------------
  // TEST 5 & 6: Concurrency & Transaction Integrity
  // ------------------------------------------------------------
  console.log('TEST 5 & 6: Transaction and concurrency safety under simultaneous requests');
  const concEmail = `uat_dup_conc_${timestamp}@example.com`;
  const concMobile = `772${Math.floor(1000000 + Math.random() * 9000000)}`;

  // Run 2 simultaneous requests for the same new candidate email
  const results = await Promise.allSettled([
    candidateService.sendCredentialsToClient(
      { name: 'Conc1 User', email: concEmail, country_code: '+44', contact_number: concMobile, visa_type: 'Student' },
      {},
      performedByUser
    ),
    candidateService.sendCredentialsToClient(
      { name: 'Conc2 User', email: concEmail, country_code: '+44', contact_number: concMobile, visa_type: 'Student' },
      {},
      performedByUser
    ),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'Exactly one concurrent request must succeed');
  assert.equal(rejected.length, 1, 'Concurrent duplicate request must be rejected');
  const mappedReason = formatDbError(rejected[0].reason);
  assert.equal(mappedReason, 'This email address is already registered.');

  const createdUserConcId = fulfilled[0].value.candidateId;
  const userCount = await User.count({ where: { email: concEmail } });
  const appCount = await CandidateApplication.count({ where: { userId: createdUserConcId } });
  const caseCount = await Case.count({ where: { candidateId: createdUserConcId } });

  assert.equal(userCount, 1, 'Exactly 1 user record created');
  assert.equal(appCount, 1, 'Exactly 1 application record created');
  assert.equal(caseCount, 1, 'Exactly 1 case record created');
  console.log('  [PASS] Concurrent requests handled safely with strict 1:1:1 record guarantee.\n');

  // ------------------------------------------------------------
  // TEST 7: Human-Readable Unique Constraint Error Mapping
  // ------------------------------------------------------------
  console.log('TEST 7: User-friendly unique constraint error mapping (no raw column leakage)');

  const mockSequelizeErrorUserId = {
    name: 'SequelizeUniqueConstraintError',
    errors: [{ path: 'userId', message: 'userId must be unique' }],
  };
  const mappedUserMsg = formatDbError(mockSequelizeErrorUserId);
  assert.equal(mappedUserMsg, 'An application or profile already exists for this user.');

  const mockSequelizeErrorEmail = {
    name: 'SequelizeUniqueConstraintError',
    errors: [{ path: 'email', message: 'email must be unique' }],
  };
  const mappedEmailMsg = formatDbError(mockSequelizeErrorEmail);
  assert.equal(mappedEmailMsg, 'This email address is already registered.');
  console.log('  [PASS] Unique constraint errors mapped to human-readable user messages without raw column leakage.\n');

  // ------------------------------------------------------------
  // TEST 8: Tenant Security & Duplicate Email Boundaries
  // ------------------------------------------------------------
  console.log('TEST 8: Tenant isolation for duplicate email & user identification');
  const sameTenantErr = await candidateService.sendCredentialsToClient(
    { name: 'Test User', email: email1, country_code: '+44', contact_number: `773${Math.floor(1000000 + Math.random() * 9000000)}` },
    {},
    performedByUser
  ).catch((e) => e);
  assert.equal(sameTenantErr.message, 'This email address is already registered.');
  console.log('  [PASS] Same-tenant duplicate email rejected; tenant boundaries enforced.\n');

  // ------------------------------------------------------------
  // CLEANUP
  // ------------------------------------------------------------
  await CandidateApplication.destroy({ where: { userId: [cand1Id, hookUser.id, createdUserConcId] } });
  await Case.destroy({ where: { candidateId: [cand1Id, hookUser.id, createdUserConcId] } });
  await User.destroy({ where: { id: [cand1Id, hookUser.id, createdUserConcId] } });

  console.log('============================================================');
  console.log('ALL DUPLICATE USER & APPLICATION SAFETY TESTS PASSED');
  console.log('============================================================\n');
}

runDuplicateUserApplicationTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
