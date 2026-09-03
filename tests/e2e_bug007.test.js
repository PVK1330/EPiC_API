import { getTenantDb } from '../src/services/tenantDb.service.js';
import { sanitizeApplicationPayload, validateFinalApplicationSubmission } from '../src/utils/applicationPayload.util.js';
import { ensureCandidateEnquiryCase } from '../src/services/candidateOnboarding.service.js';
import bcrypt from 'bcryptjs';

async function runE2EVerification() {
  console.log('============================================================');
  console.log('STARTING BUG-007 END-TO-END VERIFICATION');
  console.log('============================================================\n');

  const tenantDb = getTenantDb('epic_technoweb');
  const { User, UnverifiedUser, CandidateApplication, Case, Organisation } = tenantDb;

  // Sync postgres sequence if needed
  await tenantDb.sequelize.query(`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1));`);
  await tenantDb.sequelize.query(`SELECT setval('candidate_applications_id_seq', COALESCE((SELECT MAX(id) FROM candidate_applications), 1));`);

  const org = await Organisation.findOne({ order: [['id', 'ASC']] });
  const orgId = org ? org.id : 1;

  // ── TEST 1: Self-Registration with Rent & Landlord details ───────────────
  console.log('TEST 1: Candidate Self-Registration (Rent) -> OTP -> CandidateApplication');
  const rentEmail = `e2e_rent_${Date.now()}@example.com`;
  const rentPassword = await bcrypt.hash('StrongPass123!@#', 12);
  const otpCode = '123456';
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

  const rentProfileData = {
    address: '10 Downing Street, London',
    addressStartDate: '2022-06-01',
    housingStatus: 'Rent',
    landlordName: 'Prime Properties UK',
    landlordContactNumber: '+44 7911 123456',
    landlordEmail: 'landlord@primeproperties.co.uk',
    landlordAddress: '1 Whitehall Road, London SW1A 2AA',
    city: 'London',
    state: 'Greater London',
    country: 'United Kingdom',
    pincode: 'SW1A 2AA',
    nationality: 'British',
  };

  // 1a. Store unverified user
  const unverifiedRentUser = await UnverifiedUser.create({
    first_name: 'E2E_Rent',
    last_name: 'Tester',
    email: rentEmail,
    password: rentPassword,
    country_code: '+44',
    mobile: `79${Math.floor(10000000 + Math.random() * 90000000)}`,
    role_id: 1,
    otp_code: otpCode,
    otp_expiry: otpExpiry,
    organisation_id: orgId,
    profile_data: rentProfileData,
  });

  console.log('  -> Created UnverifiedUser id:', unverifiedRentUser.id);
  console.log('  -> profile_data stored:', unverifiedRentUser.profile_data.housingStatus, unverifiedRentUser.profile_data.landlordName);

  // 1b. Simulate OTP Verification & Candidate Creation
  const tenantUser1 = await User.create({
    first_name: unverifiedRentUser.first_name,
    last_name: unverifiedRentUser.last_name,
    email: unverifiedRentUser.email,
    password: unverifiedRentUser.password,
    country_code: unverifiedRentUser.country_code,
    mobile: unverifiedRentUser.mobile,
    role_id: 1,
    is_otp_verified: true,
    is_email_verified: true,
    status: 'active',
    organisation_id: orgId,
  });

  await ensureCandidateEnquiryCase(tenantDb, tenantUser1.id, {
    organisationId: orgId,
    profileData: unverifiedRentUser.profile_data || {},
  });

  // 1c. Inspect CandidateApplication in Database
  const rentApplication = await CandidateApplication.findOne({ where: { userId: tenantUser1.id } });
  if (!rentApplication) {
    throw new Error('FAIL: CandidateApplication was not created for rent user');
  }

  console.log('  -> CandidateApplication created in DB:');
  console.log('     addressStartDate:', rentApplication.addressStartDate);
  console.log('     housingStatus:', rentApplication.housingStatus);
  console.log('     landlordName:', rentApplication.landlordName);
  console.log('     landlordContactNumber:', rentApplication.landlordContactNumber);
  console.log('     landlordEmail:', rentApplication.landlordEmail);
  console.log('     landlordAddress:', rentApplication.landlordAddress);

  if (
    rentApplication.housingStatus !== 'Rent' ||
    rentApplication.landlordName !== 'Prime Properties UK' ||
    rentApplication.landlordContactNumber !== '+44 7911 123456' ||
    rentApplication.landlordEmail !== 'landlord@primeproperties.co.uk' ||
    rentApplication.addressStartDate !== '2022-06-01'
  ) {
    throw new Error('FAIL: Values in CandidateApplication do not match submitted profile data');
  }
  console.log('[PASS] TEST 1: Full Rent self-registration and OTP persistence verified!\n');


  // ── TEST 2: Self-Registration with Own (No Landlord details) ─────────────
  console.log('TEST 2: Candidate Self-Registration (Own) -> OTP -> CandidateApplication');
  const ownEmail = `e2e_own_${Date.now()}@example.com`;
  const ownProfileData = {
    address: '42 Baker Street, London',
    addressStartDate: '2019-03-15',
    housingStatus: 'Own',
    city: 'London',
    state: 'Greater London',
    country: 'United Kingdom',
    pincode: 'NW1 6XE',
    nationality: 'British',
  };

  const unverifiedOwnUser = await UnverifiedUser.create({
    first_name: 'E2E_Own',
    last_name: 'Tester',
    email: ownEmail,
    password: rentPassword,
    country_code: '+44',
    mobile: `79${Math.floor(10000000 + Math.random() * 90000000)}`,
    role_id: 1,
    otp_code: otpCode,
    otp_expiry: otpExpiry,
    organisation_id: orgId,
    profile_data: ownProfileData,
  });

  const tenantUser2 = await User.create({
    first_name: unverifiedOwnUser.first_name,
    last_name: unverifiedOwnUser.last_name,
    email: unverifiedOwnUser.email,
    password: unverifiedOwnUser.password,
    country_code: unverifiedOwnUser.country_code,
    mobile: unverifiedOwnUser.mobile,
    role_id: 1,
    is_otp_verified: true,
    is_email_verified: true,
    status: 'active',
    organisation_id: orgId,
  });

  await ensureCandidateEnquiryCase(tenantDb, tenantUser2.id, {
    organisationId: orgId,
    profileData: unverifiedOwnUser.profile_data || {},
  });

  const ownApplication = await CandidateApplication.findOne({ where: { userId: tenantUser2.id } });
  if (!ownApplication || ownApplication.housingStatus !== 'Own' || ownApplication.landlordName != null) {
    throw new Error('FAIL: Own application values incorrect');
  }
  console.log('  -> CandidateApplication housingStatus:', ownApplication.housingStatus);
  console.log('  -> Landlord fields are empty/null as expected.');
  console.log('[PASS] TEST 2: Own registration verified!\n');


  // ── TEST 3: Future Date Validation (Backend) ──────────────────────────────
  console.log('TEST 3: Future Date Backend Validation');
  let futureRejected = false;
  try {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 2);
    sanitizeApplicationPayload({ addressStartDate: futureDate.toISOString().slice(0, 10) });
  } catch (err) {
    if (err.status === 400 && err.message.includes('future')) {
      futureRejected = true;
      console.log('  -> Rejected with expected 400:', err.message);
    }
  }
  if (!futureRejected) throw new Error('FAIL: Backend did not reject future date with 400');
  console.log('[PASS] TEST 3: Future date backend validation passed!\n');


  // ── TEST 4: Mandatory Validation on Final Submission ─────────────────────
  console.log('TEST 4: Rent Validation (Missing Landlord Details) on Final Submission');
  let missingLandlordRejected = false;
  try {
    validateFinalApplicationSubmission({
      addressStartDate: '2023-01-01',
      housingStatus: 'Rent',
      landlordName: '',
      landlordContactNumber: '',
    });
  } catch (err) {
    if (err.status === 400 && err.message.includes('Landlord name')) {
      missingLandlordRejected = true;
      console.log('  -> Rejected with expected 400:', err.message);
    }
  }
  if (!missingLandlordRejected) throw new Error('FAIL: Backend did not enforce landlord name when renting');
  console.log('[PASS] TEST 4: Rent landlord validation passed!\n');


  // ── TEST 5: Legacy Client Compatibility ──────────────────────────────────
  console.log('TEST 5: Legacy Client Compatibility');
  const legacyEmail = `e2e_legacy_${Date.now()}@example.com`;
  const legacyUser = await User.create({
    first_name: 'E2E_Legacy',
    last_name: 'Client',
    email: legacyEmail,
    password: rentPassword,
    country_code: '+44',
    mobile: `79${Math.floor(10000000 + Math.random() * 90000000)}`,
    role_id: 1,
    is_otp_verified: true,
    is_email_verified: true,
    status: 'active',
    organisation_id: orgId,
  });

  // Create legacy app with NULL move-in date and NULL housing status
  const legacyApp = await CandidateApplication.create({
    userId: legacyUser.id,
    firstName: 'E2E_Legacy',
    lastName: 'Client',
    email: legacyEmail,
    address: 'Legacy Address without move-in date',
    addressStartDate: null,
    housingStatus: null,
    landlordName: null,
    organisation_id: orgId,
  });

  console.log('  -> Legacy CandidateApplication created with NULL date and housing:', legacyApp.id);
  const loadedLegacy = await CandidateApplication.findByPk(legacyApp.id);
  if (!loadedLegacy || loadedLegacy.addressStartDate !== null) {
    throw new Error('FAIL: Legacy record failed to load with NULL values');
  }

  // Update legacy record with move-in date and landlord details
  await loadedLegacy.update(
    sanitizeApplicationPayload({
      addressStartDate: '2021-08-10',
      housingStatus: 'Rent',
      landlordName: 'New Landlord',
      landlordContactNumber: '07000000000',
    })
  );

  const updatedLegacy = await CandidateApplication.findByPk(legacyApp.id);
  if (updatedLegacy.addressStartDate !== '2021-08-10' || updatedLegacy.landlordName !== 'New Landlord') {
    throw new Error('FAIL: Legacy record failed to update');
  }
  console.log('  -> Legacy record successfully updated with move-in date and landlord.');
  console.log('[PASS] TEST 5: Legacy record compatibility passed!\n');

  // Clean up test records
  await rentApplication.destroy();
  await tenantUser1.destroy();
  await unverifiedRentUser.destroy();
  await ownApplication.destroy();
  await tenantUser2.destroy();
  await unverifiedOwnUser.destroy();
  await updatedLegacy.destroy();
  await legacyUser.destroy();

  console.log('============================================================');
  console.log('ALL E2E BUG-007 VERIFICATION SCENARIOS PASSED 100%');
  console.log('============================================================');
  process.exit(0);
}

runE2EVerification().catch((err) => {
  console.error('\nE2E VERIFICATION FAILED:', err);
  process.exit(1);
});
