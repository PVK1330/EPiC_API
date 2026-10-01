import dotenv from 'dotenv';
dotenv.config({ path: './Server/.env' });
process.env.NODE_ENV = 'development';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getTenantDb } from '../src/services/tenantDb.service.js';
import { ROLES } from '../src/middlewares/role.middleware.js';
import { CandidateService } from '../src/modules/Admin/Candidates/candidate.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

describe('Issue #8: Visa Expiry Alerts Widget Real Count', async () => {
  const tenantDb = getTenantDb(process.env.TEST_TENANT_DB || 'epic_technoweb');
  const { User, Organisation, CandidateApplication, Case, VisaType } = tenantDb;
  const candidateService = new CandidateService(tenantDb);

  // Sync sequences
  await tenantDb.sequelize.query(`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1));`);
  await tenantDb.sequelize.query(`SELECT setval('candidate_applications_id_seq', COALESCE((SELECT MAX(id) FROM candidate_applications), 1));`);
  await tenantDb.sequelize.query(`SELECT setval('cases_id_seq', COALESCE((SELECT MAX(id) FROM cases), 1));`);

  let counter = Date.now();

  async function createTestOrg(prefix = 'Org') {
    const unique = `${counter++}_${Math.floor(Math.random() * 10000)}`;
    return await Organisation.create({
      name: `Issue8 ${prefix} ${unique}`,
      slug: `slug-issue8-${unique}`,
      primaryEmail: `org_${unique}@example.com`,
      code: `O${Math.floor(Math.random() * 1000)}`,
      status: 'active',
    });
  }

  async function createTestClient(namePrefix, organisationId) {
    return await User.create({
      first_name: namePrefix,
      last_name: 'ClientTester',
      email: `test_issue8_${counter++}_${Math.floor(Math.random() * 10000)}@example.com`,
      country_code: '+44',
      mobile: `778${Math.floor(1000000 + Math.random() * 9000000)}`,
      password: 'HashedPassword123!',
      role_id: ROLES.CANDIDATE,
      is_email_verified: true,
      is_otp_verified: true,
      status: 'active',
      organisation_id: organisationId,
    });
  }

  // =========================================================================
  // TEST 1: No upcoming expiries -> count = 0
  // =========================================================================
  test('TEST 1 — No upcoming expiries: count = 0', async () => {
    const org = await createTestOrg('T1');
    const client = await createTestClient('T1_NoExpiries', org.id);

    // Case with expiry 180 days in future (outside 30-day window)
    const farDate = new Date();
    farDate.setDate(farDate.getDate() + 180);

    await Case.create({
      caseId: `CAS-801-${counter++}`,
      candidateId: client.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      visaEndDate: farDate,
      organisation_id: org.id,
    });

    const count = await candidateService.countUpcomingVisaExpiryAlerts({ organisationId: org.id });
    assert.equal(count, 0, 'Count must be 0 when no expiries are upcoming');

    const res = await candidateService.getAllCandidates({}, org.id);
    assert.equal(res.visaExpiryAlertsCount, 0);
    assert.equal(res.visaExpiryAlerts?.count, 0);
  });

  // =========================================================================
  // TEST 2: One upcoming expiry -> count = 1
  // =========================================================================
  test('TEST 2 — One upcoming expiry: count = 1', async () => {
    const org = await createTestOrg('T2');
    const client = await createTestClient('T2_OneExpiry', org.id);

    // Expiry in 15 days (within 30-day window)
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 15);

    await Case.create({
      caseId: `CAS-802-${counter++}`,
      candidateId: client.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      visaEndDate: expiryDate,
      organisation_id: org.id,
    });

    const count = await candidateService.countUpcomingVisaExpiryAlerts({ organisationId: org.id });
    assert.equal(count, 1, 'Count must be 1 for one upcoming expiry');

    const res = await candidateService.getAllCandidates({}, org.id);
    assert.equal(res.visaExpiryAlertsCount, 1);
  });

  // =========================================================================
  // TEST 3: Multiple upcoming expiries -> exact count
  // =========================================================================
  test('TEST 3 — Multiple upcoming expiries: exact count', async () => {
    const org = await createTestOrg('T3');
    
    // Create 3 clients with expiries in 5, 12, and 28 days
    const days = [5, 12, 28];
    for (let i = 0; i < days.length; i++) {
      const client = await createTestClient(`T3_Client_${i}`, org.id);
      const exp = new Date();
      exp.setDate(exp.getDate() + days[i]);
      await Case.create({
        caseId: `CAS-803-${counter++}`,
        candidateId: client.id,
        status: 'In Progress',
        targetSubmissionDate: '2026-12-31',
        visaEndDate: exp,
        organisation_id: org.id,
      });
    }

    const count = await candidateService.countUpcomingVisaExpiryAlerts({ organisationId: org.id });
    assert.equal(count, 3, 'Count must match exact number of upcoming expiries (3)');

    const res = await candidateService.getAllCandidates({}, org.id);
    assert.equal(res.visaExpiryAlertsCount, 3);
  });

  // =========================================================================
  // TEST 4: Expiry outside alert window -> not counted
  // =========================================================================
  test('TEST 4 — Expiry outside alert window: past date and >30 days not counted', async () => {
    const org = await createTestOrg('T4');

    // Client 1: expired 5 days ago (past date)
    const clientPast = await createTestClient('T4_Past', org.id);
    const pastExp = new Date();
    pastExp.setDate(pastExp.getDate() - 5);
    await Case.create({
      caseId: `CAS-804A-${counter++}`,
      candidateId: clientPast.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      visaEndDate: pastExp,
      organisation_id: org.id,
    });

    // Client 2: expires in 45 days (beyond 30 days)
    const clientFuture = await createTestClient('T4_Future', org.id);
    const futureExp = new Date();
    futureExp.setDate(futureExp.getDate() + 45);
    await Case.create({
      caseId: `CAS-804B-${counter++}`,
      candidateId: clientFuture.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      visaEndDate: futureExp,
      organisation_id: org.id,
    });

    const count = await candidateService.countUpcomingVisaExpiryAlerts({ organisationId: org.id, windowDays: 30 });
    assert.equal(count, 0, 'Past expiries and expiries > 30 days must not be counted');
  });

  // =========================================================================
  // TEST 5: Current case vs historical case
  // Historical case expiry is upcoming.
  // Current case expiry is not upcoming.
  // Expected: historical case must NOT cause an alert.
  // =========================================================================
  test('TEST 5 — Current case vs historical case: historical expiry must NOT cause an alert', async () => {
    const org = await createTestOrg('T5');
    const client = await createTestClient('T5_HistVsCurr', org.id);

    // Historical case (Completed): expiry in 10 days (upcoming)
    const expHist = new Date();
    expHist.setDate(expHist.getDate() + 10);
    await Case.create({
      caseId: `CAS-805H-${counter++}`,
      candidateId: client.id,
      status: 'Completed',
      targetSubmissionDate: '2024-01-01',
      visaEndDate: expHist,
      organisation_id: org.id,
      created_at: new Date(Date.now() - 500000),
      updated_at: new Date(Date.now() - 500000),
    });

    // Current case (In Progress): expiry in 150 days (not upcoming)
    const expCurr = new Date();
    expCurr.setDate(expCurr.getDate() + 150);
    await Case.create({
      caseId: `CAS-805C-${counter++}`,
      candidateId: client.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      visaEndDate: expCurr,
      organisation_id: org.id,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const count = await candidateService.countUpcomingVisaExpiryAlerts({ organisationId: org.id });
    assert.equal(count, 0, 'Historical case expiry must NOT cause an alert when current case is not upcoming');
  });

  // =========================================================================
  // TEST 6: Current case expiry
  // Current case has upcoming expiry -> counted
  // =========================================================================
  test('TEST 6 — Current case expiry: current case has upcoming expiry -> counted', async () => {
    const org = await createTestOrg('T6');
    const client = await createTestClient('T6_CurrentUpcoming', org.id);

    // Historical case (Completed): expiry was far or null
    await Case.create({
      caseId: `CAS-806H-${counter++}`,
      candidateId: client.id,
      status: 'Completed',
      targetSubmissionDate: '2024-01-01',
      visaEndDate: null,
      organisation_id: org.id,
      created_at: new Date(Date.now() - 500000),
      updated_at: new Date(Date.now() - 500000),
    });

    // Current case (In Progress): expiry in 10 days (upcoming)
    const expCurr = new Date();
    expCurr.setDate(expCurr.getDate() + 10);
    await Case.create({
      caseId: `CAS-806C-${counter++}`,
      candidateId: client.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      visaEndDate: expCurr,
      organisation_id: org.id,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const count = await candidateService.countUpcomingVisaExpiryAlerts({ organisationId: org.id });
    assert.equal(count, 1, 'Current case with upcoming expiry must be counted');
  });

  // =========================================================================
  // TEST 7: Missing expiry
  // Current case has no expiry date -> not counted
  // =========================================================================
  test('TEST 7 — Missing expiry: current case has no expiry date -> not counted', async () => {
    const org = await createTestOrg('T7');
    const client = await createTestClient('T7_MissingExpiry', org.id);

    // Old application/historical case had an expiry date
    const oldExp = new Date();
    oldExp.setDate(oldExp.getDate() + 10);
    await Case.create({
      caseId: `CAS-807H-${counter++}`,
      candidateId: client.id,
      status: 'Completed',
      targetSubmissionDate: '2024-01-01',
      visaEndDate: oldExp,
      organisation_id: org.id,
      created_at: new Date(Date.now() - 500000),
      updated_at: new Date(Date.now() - 500000),
    });

    // Current case has NO visa expiry date
    await Case.create({
      caseId: `CAS-807C-${counter++}`,
      candidateId: client.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      visaEndDate: null,
      organisation_id: org.id,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const count = await candidateService.countUpcomingVisaExpiryAlerts({ organisationId: org.id });
    assert.equal(count, 0, 'Current case without expiry date must not trigger an alert or use historical date');
  });

  // =========================================================================
  // TEST 8: Deleted case
  // Upcoming expiry belongs to deleted case -> not counted
  // =========================================================================
  test('TEST 8 — Deleted case: upcoming expiry on deleted case -> not counted', async () => {
    const org = await createTestOrg('T8');
    const client = await createTestClient('T8_DeletedCase', org.id);

    const exp = new Date();
    exp.setDate(exp.getDate() + 12);

    // Case has upcoming expiry but is soft-deleted
    await Case.create({
      caseId: `CAS-808D-${counter++}`,
      candidateId: client.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      visaEndDate: exp,
      deleted_at: new Date(),
      organisation_id: org.id,
    });

    const count = await candidateService.countUpcomingVisaExpiryAlerts({ organisationId: org.id });
    assert.equal(count, 0, 'Soft-deleted cases must not be counted');
  });

  // =========================================================================
  // TEST 9: Organisation isolation
  // Org A has upcoming expiry, Org B has none -> each sees only its own count
  // =========================================================================
  test('TEST 9 — Organisation isolation: Org A and Org B counts remain completely isolated', async () => {
    const org1 = await createTestOrg('T9A');
    const org2 = await createTestOrg('T9B');

    const clientA = await createTestClient('T9_ClientA', org1.id);
    const expA = new Date();
    expA.setDate(expA.getDate() + 14);

    await Case.create({
      caseId: `CAS-809A-${counter++}`,
      candidateId: clientA.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      visaEndDate: expA,
      organisation_id: org1.id,
    });

    const clientB = await createTestClient('T9_ClientB', org2.id);
    const expB = new Date();
    expB.setDate(expB.getDate() + 120); // Not upcoming

    await Case.create({
      caseId: `CAS-809B-${counter++}`,
      candidateId: clientB.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      visaEndDate: expB,
      organisation_id: org2.id,
    });

    const countA = await candidateService.countUpcomingVisaExpiryAlerts({ organisationId: org1.id });
    const countB = await candidateService.countUpcomingVisaExpiryAlerts({ organisationId: org2.id });

    assert.equal(countA, 1, 'Org 1 must see 1 upcoming expiry');
    assert.equal(countB, 0, 'Org 2 must see 0 upcoming expiries (no leakage from Org 1)');
  });

  // =========================================================================
  // TEST 10: Multiple cases
  // Client has multiple historical/current cases -> only current case is evaluated
  // =========================================================================
  test('TEST 10 — Multiple cases: only the appropriate current case contributes to count', async () => {
    const org = await createTestOrg('T10');
    const client = await createTestClient('T10_MultiCases', org.id);

    const now = Date.now();

    // Case 1 (Completed): expiry in 5 days
    const exp1 = new Date();
    exp1.setDate(exp1.getDate() + 5);
    await Case.create({
      caseId: `CAS-810A-${counter++}`,
      candidateId: client.id,
      status: 'Completed',
      targetSubmissionDate: '2023-01-01',
      visaEndDate: exp1,
      organisation_id: org.id,
      created_at: new Date(now - 300000),
      updated_at: new Date(now - 300000),
    });

    // Case 2 (Completed): expiry in 10 days
    const exp2 = new Date();
    exp2.setDate(exp2.getDate() + 10);
    await Case.create({
      caseId: `CAS-810B-${counter++}`,
      candidateId: client.id,
      status: 'Completed',
      targetSubmissionDate: '2024-01-01',
      visaEndDate: exp2,
      organisation_id: org.id,
      created_at: new Date(now - 200000),
      updated_at: new Date(now - 200000),
    });

    // Case 3 (In Progress — current case): expiry in 200 days (not upcoming)
    const exp3 = new Date();
    exp3.setDate(exp3.getDate() + 200);
    await Case.create({
      caseId: `CAS-810C-${counter++}`,
      candidateId: client.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      visaEndDate: exp3,
      organisation_id: org.id,
      created_at: new Date(now),
      updated_at: new Date(now),
    });

    const count = await candidateService.countUpcomingVisaExpiryAlerts({ organisationId: org.id });
    assert.equal(count, 0, 'Only the current active case is evaluated, ignoring all older completed cases');
  });

  // =========================================================================
  // TEST 11: Frontend hardcoded value removed
  // =========================================================================
  test('TEST 11 — Frontend hardcoded value removed: AdminCandidates.jsx does not have static 0', () => {
    const adminCandidatesPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'pages', 'admin', 'AdminCandidates.jsx');
    const src = fs.readFileSync(adminCandidatesPath, 'utf8');

    // Verify static <p className="text-2xl font-black text-red-500">0</p> is removed
    assert.ok(
      !src.includes('<p className="text-2xl font-black text-red-500">0</p>'),
      'Hardcoded static <p>0</p> must be removed from Visa Expiry Alerts widget',
    );

    // Verify dynamic visaExpiryAlertsCount is used
    assert.ok(
      src.includes('visaExpiryAlertsCount'),
      'AdminCandidates must use visaExpiryAlertsCount',
    );
  });

  // =========================================================================
  // TEST 12: Zero is displayed correctly
  // =========================================================================
  test('TEST 12 — Zero is displayed correctly: 0 is valid and displayed when count is 0', () => {
    const adminCandidatesPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'pages', 'admin', 'AdminCandidates.jsx');
    const src = fs.readFileSync(adminCandidatesPath, 'utf8');

    assert.ok(
      src.includes("typeof visaExpiryAlertsCount === 'number' ? visaExpiryAlertsCount : 0"),
      'Widget renders real count when 0 or positive',
    );
  });

  // =========================================================================
  // CONFIRMATION: Terminology "Client" preserved and Exactly 2 Caseworkers Rule
  // =========================================================================
  test('CONFIRMATION: Terminology "Client" preserved and single-caseworker rule in place', () => {
    const cwControllerPath = path.join(rootDir, 'Server', 'src', 'modules', 'Caseworker', 'Cases', 'caseworkerCase.controller.js');
    const cwControllerSrc = fs.readFileSync(cwControllerPath, 'utf8');
    // BUG-017 / Phase 2 UAT: one caseworker per case (the "exactly 2" rule was reverted).
    assert.ok(
      cwControllerSrc.includes('singleCaseworkerError') && !cwControllerSrc.includes('cwIds.length !== 2'),
      'Backend controller enforces one caseworker per case',
    );

    const adminCandidatesPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'pages', 'admin', 'AdminCandidates.jsx');
    const adminCandidatesSrc = fs.readFileSync(adminCandidatesPath, 'utf8');
    assert.ok(adminCandidatesSrc.includes('RoleBadge role="Client"'), 'Client terminology preserved');
  });
});
