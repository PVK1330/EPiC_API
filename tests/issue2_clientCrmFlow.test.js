import dotenv from 'dotenv';
dotenv.config({ path: './Server/.env' });
process.env.NODE_ENV = 'development';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import platformDb from '../src/models/index.js';
import { getTenantDb } from '../src/services/tenantDb.service.js';
import { CandidateService } from '../src/modules/Admin/Candidates/candidate.service.js';
import { createUserOnPlatformAndTenant } from '../src/services/userSync.service.js';
import { ensureCandidateEnquiryCase } from '../src/services/candidateOnboarding.service.js';
import { ROLES } from '../src/middlewares/role.middleware.js';

describe('Issue #2: Client Details Must Flow Automatically Into CRM Suite', async () => {
  const tenantDb = getTenantDb('epic_technoweb');
  const candidateService = new CandidateService(tenantDb);
  const { User, Organisation, Case, CandidateApplication } = tenantDb;

  const org = await Organisation.findOne({ order: [['id', 'ASC']] });
  const orgId = org ? org.id : 1;
  const timestamp = Date.now();

  // Sync DB sequences to avoid collision with dirty test rows or orphaned rows from other tests
  const [[{ m: maxUser }]] = await tenantDb.sequelize.query(`SELECT COALESCE(MAX(id), 1) as m FROM users;`);
  const [[{ m: maxAppUser }]] = await tenantDb.sequelize.query(`SELECT COALESCE(MAX("userId"), 1) as m FROM candidate_applications;`);
  const [[{ m: maxPlatformUser }]] = await platformDb.sequelize.query(`SELECT COALESCE(MAX(id), 1) as m FROM users;`);
  const safeId = Math.max(Number(maxUser), Number(maxAppUser), Number(maxPlatformUser));

  await tenantDb.sequelize.query(`SELECT setval('users_id_seq', ${safeId});`);
  await tenantDb.sequelize.query(`SELECT setval('candidate_applications_id_seq', COALESCE((SELECT MAX(id) FROM candidate_applications), 1));`);
  await tenantDb.sequelize.query(`SELECT setval('cases_id_seq', COALESCE((SELECT MAX(id) FROM cases), 1));`);
  await platformDb.sequelize.query(`SELECT setval('users_id_seq', ${safeId});`);

  const sampleClientProfile = {
    first_name: 'Ahmad',
    last_name: 'Khan',
    email: `ahmad.khan.${timestamp}@example.com`,
    country_code: '+44',
    mobile: `789${Math.floor(1000000 + Math.random() * 9000000)}`,
    date_of_birth: '1992-05-14',
    address: '42 High Street, Birmingham, B1 1AA, UK',
    addressStartDate: '2022-01-15',
    housingStatus: 'Rent',
    landlordName: 'Arthur Pendelton',
    landlordContactNumber: '07123999888',
    landlordEmail: 'landlord.arthur@example.com',
    landlordAddress: '10 King Street, Birmingham',
    nationality: 'Pakistani',
    nationalities: ['Pakistani'],
  };

  let registeredUserId = null;

  test('TEST 1: Client completes self-registration & verification -> CRM record created and data flows to CRM', async () => {
    // 1. Simulate registration & OTP verification flow creating user on platform and tenant
    const user = await createUserOnPlatformAndTenant(tenantDb, {
      first_name: sampleClientProfile.first_name,
      last_name: sampleClientProfile.last_name,
      email: sampleClientProfile.email,
      country_code: sampleClientProfile.country_code,
      mobile: sampleClientProfile.mobile,
      password: 'HashedPassword123!',
      role_id: ROLES.CANDIDATE,
      is_email_verified: true,
      is_otp_verified: true,
      status: 'active',
      organisation_id: orgId,
    });

    assert.ok(user && user.id, 'User account must be created');
    registeredUserId = user.id;

    // 2. Automated CRM record creation (Application + Enquiry Case)
    await ensureCandidateEnquiryCase(tenantDb, user.id, {
      organisationId: orgId,
      profileData: {
        firstName: sampleClientProfile.first_name,
        lastName: sampleClientProfile.last_name,
        email: sampleClientProfile.email,
        contactNumber: sampleClientProfile.mobile,
        dob: sampleClientProfile.date_of_birth,
        address: sampleClientProfile.address,
        addressStartDate: sampleClientProfile.addressStartDate,
        housingStatus: sampleClientProfile.housingStatus,
        landlordName: sampleClientProfile.landlordName,
        landlordContactNumber: sampleClientProfile.landlordContactNumber,
        landlordEmail: sampleClientProfile.landlordEmail,
        landlordAddress: sampleClientProfile.landlordAddress,
        nationality: sampleClientProfile.nationality,
        nationalities: sampleClientProfile.nationalities,
      },
    });

    // 3. Verify in Tenant DB that CRM records exist
    const application = await CandidateApplication.findOne({ where: { userId: user.id } });
    assert.ok(application, 'CandidateApplication CRM record must be created');
    assert.equal(application.status, 'draft');
    assert.equal(application.firstName, sampleClientProfile.first_name);
    assert.equal(application.lastName, sampleClientProfile.last_name);
    assert.equal(application.email, sampleClientProfile.email);
    assert.equal(application.housingStatus, 'Rent');
    assert.equal(application.landlordName, sampleClientProfile.landlordName);
    assert.equal(application.nationality, 'Pakistani');

    const enquiryCase = await Case.findOne({ where: { candidateId: user.id } });
    assert.ok(enquiryCase, 'Enquiry Case CRM record must be created');
    assert.equal(enquiryCase.status, 'Lead');

    // 4. Verify client is visible in Admin CRM getAllCandidates
    const adminList = await candidateService.getAllCandidates({ search: sampleClientProfile.email });
    assert.ok(adminList.candidates.length >= 1, 'Client must appear in Admin CRM list');
    const matched = adminList.candidates.find((c) => c.id === user.id);
    assert.ok(matched, 'Admin CRM list must contain the registered client');
    assert.equal(matched.email, sampleClientProfile.email);
  });

  test('TEST 2: Client completes verification -> No duplicate Client or Case records created', async () => {
    // Verify strict 1:1 relationship
    const userCount = await User.count({ where: { email: sampleClientProfile.email } });
    const appCount = await CandidateApplication.count({ where: { userId: registeredUserId } });
    const caseCount = await Case.count({ where: { candidateId: registeredUserId } });

    assert.equal(userCount, 1, 'Exactly one User record must exist');
    assert.equal(appCount, 1, 'Exactly one CandidateApplication record must exist');
    assert.equal(caseCount, 1, 'Exactly one Case record must exist');
  });

  test('TEST 3: Registration/verification is retried -> Existing record is safely reused without duplicating', async () => {
    // Re-run createUserOnPlatformAndTenant with same email and organisation
    const retriedUser = await createUserOnPlatformAndTenant(tenantDb, {
      first_name: sampleClientProfile.first_name,
      last_name: sampleClientProfile.last_name,
      email: sampleClientProfile.email,
      country_code: sampleClientProfile.country_code,
      mobile: sampleClientProfile.mobile,
      password: 'HashedPassword123!',
      role_id: ROLES.CANDIDATE,
      is_email_verified: true,
      is_otp_verified: true,
      status: 'active',
      organisation_id: orgId,
    });

    assert.equal(retriedUser.id, registeredUserId, 'Retried registration must resolve to the existing user ID');

    // Re-run ensureCandidateEnquiryCase
    await ensureCandidateEnquiryCase(tenantDb, registeredUserId, {
      organisationId: orgId,
      profileData: {
        firstName: sampleClientProfile.first_name,
        lastName: sampleClientProfile.last_name,
        email: sampleClientProfile.email,
        contactNumber: sampleClientProfile.mobile,
        dob: sampleClientProfile.date_of_birth,
      },
    });

    const userCountAfter = await User.count({ where: { email: sampleClientProfile.email } });
    const appCountAfter = await CandidateApplication.count({ where: { userId: registeredUserId } });
    const caseCountAfter = await Case.count({ where: { candidateId: registeredUserId } });

    assert.equal(userCountAfter, 1, 'Retried operation must NOT create duplicate User');
    assert.equal(appCountAfter, 1, 'Retried operation must NOT create duplicate CandidateApplication');
    assert.equal(caseCountAfter, 1, 'Retried operation must NOT create duplicate Case');
  });

  test('TEST 4: Registered Client appears in the correct organisation/tenant -> No cross-tenant leakage', async () => {
    const userInTenant = await User.findByPk(registeredUserId);
    assert.equal(userInTenant.organisation_id, orgId, 'User must belong to the correct organisation');

    const appInTenant = await CandidateApplication.findOne({ where: { userId: registeredUserId } });
    assert.equal(appInTenant.organisation_id, orgId, 'Application must belong to the correct organisation');

    // Platform DB check: user is linked to correct org
    const platformUser = await platformDb.User.findOne({
      where: { email: sampleClientProfile.email, organisation_id: orgId },
    });
    assert.ok(platformUser, 'Platform user must be scoped to the correct organisation');
    assert.equal(platformUser.organisation_id, orgId);

    // Cross-tenant verification: user does not exist in an unrelated organisation ID
    const unrelatedOrgUser = await platformDb.User.findOne({
      where: { email: sampleClientProfile.email, organisation_id: 999999 },
    });
    assert.equal(unrelatedOrgUser, null, 'No cross-tenant user record must exist');
  });

  test('TEST 5: Admin opens the registered Client -> Registration data is displayed correctly without manual re-entry', async () => {
    // Admin retrieves the full client record using getCandidateById
    const clientDetails = await candidateService.getCandidateById(registeredUserId);

    assert.ok(clientDetails, 'Admin must be able to load candidate by ID');
    assert.equal(clientDetails.first_name, sampleClientProfile.first_name);
    assert.equal(clientDetails.last_name, sampleClientProfile.last_name);
    assert.equal(clientDetails.email, sampleClientProfile.email);
    assert.equal(clientDetails.mobile, sampleClientProfile.mobile);

    const app = clientDetails.application;
    assert.ok(app, 'Application details must be attached to the client record');
    assert.equal(app.firstName, sampleClientProfile.first_name);
    assert.equal(app.lastName, sampleClientProfile.last_name);
    assert.equal(app.email, sampleClientProfile.email);
    assert.equal(app.housingStatus, sampleClientProfile.housingStatus);
    assert.equal(app.landlordName, sampleClientProfile.landlordName);
    assert.equal(app.landlordContactNumber, sampleClientProfile.landlordContactNumber);
    assert.equal(app.landlordEmail, sampleClientProfile.landlordEmail);
    assert.equal(app.landlordAddress, sampleClientProfile.landlordAddress);
    assert.equal(app.address, sampleClientProfile.address);
    assert.equal(app.nationality, sampleClientProfile.nationality);

    const cases = clientDetails.cases;
    assert.ok(Array.isArray(cases) && cases.length > 0, 'Cases list must be attached');
    assert.equal(cases[0].status, 'Lead');
  });

  test('TEST 6: Existing Admin "Add Client" flow continues working normally', async () => {
    const manualTimestamp = Date.now();
    const manualClientEmail = `manual.client.${manualTimestamp}@example.com`;
    const manualMobile = `791${Math.floor(1000000 + Math.random() * 9000000)}`;

    const createResult = await candidateService.createCandidate(
      {
        first_name: 'Manual',
        last_name: 'Client',
        email: manualClientEmail,
        country_code: '+44',
        mobile: manualMobile,
        organisation_id: orgId,
        application: {
          firstName: 'Manual',
          lastName: 'Client',
          email: manualClientEmail,
          contactNumber: manualMobile,
          nationality: 'British',
          housingStatus: 'Own',
        },
      },
      {},
      { id: 1, organisation_id: orgId }
    );

    assert.ok(createResult && createResult.candidate, 'Manual creation must return candidate');
    const createdId = createResult.candidate.id;

    // Verify candidate was created with application and case
    const manualLoaded = await candidateService.getCandidateById(createdId);
    assert.ok(manualLoaded, 'Manually created candidate must be fetchable');
    assert.equal(manualLoaded.first_name, 'Manual');
    assert.equal(manualLoaded.email, manualClientEmail);
    assert.ok(manualLoaded.application, 'Manually created candidate must have application');
    assert.equal(manualLoaded.application.nationality, 'British');
    assert.equal(manualLoaded.application.housingStatus, 'Own');
  });
});
