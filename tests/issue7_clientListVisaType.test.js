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
import { CandidateService, resolveCurrentCase } from '../src/modules/Admin/Candidates/candidate.service.js';
import { syncApplicationVisaRefusals } from '../src/services/visaRefusal.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

describe('Issue #7: Client List Shows Wrong Visa Type', async () => {
  const tenantDb = getTenantDb('epic_technoweb');
  const { User, Organisation, CandidateApplication, Case, VisaType, CandidateVisaRefusal } = tenantDb;
  const candidateService = new CandidateService(tenantDb);

  // Sync sequences
  await tenantDb.sequelize.query(`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1));`);
  await tenantDb.sequelize.query(`SELECT setval('candidate_applications_id_seq', COALESCE((SELECT MAX(id) FROM candidate_applications), 1));`);
  await tenantDb.sequelize.query(`SELECT setval('cases_id_seq', COALESCE((SELECT MAX(id) FROM cases), 1));`);
  await tenantDb.sequelize.query(`SELECT setval('visa_types_id_seq', COALESCE((SELECT MAX(id) FROM visa_types), 1));`);

  const org = await Organisation.findOne({ order: [['id', 'ASC']] });
  const orgId = org ? org.id : 1;
  let counter = Date.now();

  // Find or create Visa Types
  async function findOrCreateVisa(name) {
    let vt = await VisaType.findOne({ where: { name } });
    if (!vt) {
      vt = await VisaType.create({ name, description: name, active: true });
    }
    return vt;
  }

  const vtSkilledWorker = await findOrCreateVisa('Skilled Worker Visa');
  const vtILR = await findOrCreateVisa('ILR');
  const vtVisitor = await findOrCreateVisa('Visitor Visa');

  async function createTestClient(namePrefix) {
    return await User.create({
      first_name: namePrefix,
      last_name: 'ClientTester',
      email: `test_issue7_${counter++}_${Math.floor(Math.random() * 10000)}@example.com`,
      country_code: '+44',
      mobile: `788${Math.floor(1000000 + Math.random() * 9000000)}`,
      password: 'HashedPassword123!',
      role_id: ROLES.CANDIDATE,
      is_email_verified: true,
      is_otp_verified: true,
      status: 'active',
      organisation_id: orgId,
    });
  }

  // =========================================================================
  // TEST 1: Current ILR
  // Previous visa on application = Skilled Worker
  // Current active case = ILR
  // Expected Client List = ILR (NOT Skilled Worker)
  // =========================================================================
  test('TEST 1 — Current ILR: Previous = Skilled Worker, Current = ILR -> Expected = ILR', async () => {
    const client = await createTestClient('T1_CurrentILR');

    // Candidate application has previous holding visa: Skilled Worker
    await CandidateApplication.create({
      userId: client.id,
      firstName: client.first_name,
      lastName: client.last_name,
      addressStartDate: '2023-01-01',
      housingStatus: 'Own',
      visaType: 'Skilled Worker Visa', // previous visa held
      status: 'submitted',
    });

    // Current active case is ILR
    const caseRecord = await Case.create({
      caseId: `CAS-701-${counter++}`,
      candidateId: client.id,
      visaTypeId: vtILR.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      organisation_id: orgId,
    });

    // Fetch via candidate service (Client list backend query)
    const result = await candidateService.getAllCandidates({ search: client.email });
    const clientRow = result.candidates.find((c) => c.id === client.id);

    assert.ok(clientRow, 'Client must be returned in the Client list');
    assert.equal(clientRow.currentVisaType, 'ILR', 'currentVisaType must be ILR');

    // Verify resolveCurrentCase picks this case
    const resolved = resolveCurrentCase(clientRow.cases);
    assert.equal(resolved.id, caseRecord.id);
    assert.equal(resolved.visaType?.name, 'ILR');
  });

  // =========================================================================
  // TEST 2: Current Skilled Worker
  // Previous = Visitor
  // Current = Skilled Worker
  // Expected = Skilled Worker
  // =========================================================================
  test('TEST 2 — Current Skilled Worker: Previous = Visitor, Current = Skilled Worker -> Expected = Skilled Worker', async () => {
    const client = await createTestClient('T2_CurrentSW');

    await CandidateApplication.create({
      userId: client.id,
      firstName: client.first_name,
      lastName: client.last_name,
      addressStartDate: '2023-01-01',
      housingStatus: 'Own',
      visaType: 'Visitor Visa', // previous visa held
      status: 'submitted',
    });

    await Case.create({
      caseId: `CAS-702-${counter++}`,
      candidateId: client.id,
      visaTypeId: vtSkilledWorker.id,
      status: 'Under Review',
      targetSubmissionDate: '2026-12-31',
      organisation_id: orgId,
    });

    const result = await candidateService.getAllCandidates({ search: client.email });
    const clientRow = result.candidates.find((c) => c.id === client.id);

    assert.ok(clientRow);
    assert.equal(clientRow.currentVisaType, 'Skilled Worker Visa');
  });

  // =========================================================================
  // TEST 3: Multiple historical applications / cases
  // Historical Case 1: Skilled Worker (Completed)
  // Historical Case 2: Visitor (Completed)
  // Current Case 3: ILR (In Progress)
  // Expected = ILR
  // =========================================================================
  test('TEST 3 — Multiple historical applications: Historical = Skilled Worker, Visitor; Current = ILR -> Expected = ILR', async () => {
    const client = await createTestClient('T3_MultiHistory');

    // Case 1 (oldest, completed)
    await Case.create({
      caseId: `CAS-703-${counter++}`,
      candidateId: client.id,
      visaTypeId: vtSkilledWorker.id,
      status: 'Completed',
      targetSubmissionDate: '2022-01-01',
      organisation_id: orgId,
    });

    // Case 2 (second, completed)
    await Case.create({
      caseId: `CAS-704-${counter++}`,
      candidateId: client.id,
      visaTypeId: vtVisitor.id,
      status: 'Completed',
      targetSubmissionDate: '2023-01-01',
      organisation_id: orgId,
    });

    // Case 3 (current, in progress)
    const currentCase = await Case.create({
      caseId: `CAS-705-${counter++}`,
      candidateId: client.id,
      visaTypeId: vtILR.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      organisation_id: orgId,
    });

    const result = await candidateService.getAllCandidates({ search: client.email });
    const clientRow = result.candidates.find((c) => c.id === client.id);

    assert.ok(clientRow);
    assert.equal(clientRow.cases.length, 3, 'Client has 3 cases');
    assert.equal(clientRow.currentVisaType, 'ILR', 'Current active case must determine currentVisaType');
    assert.equal(clientRow.currentCase?.id, currentCase.id);
  });

  // =========================================================================
  // TEST 4: Multiple refusal records
  // Refusal history: Skilled Worker, Visitor
  // Current case: ILR
  // Expected = ILR (Refusals must NOT override the current case)
  // =========================================================================
  test('TEST 4 — Multiple refusal records: Refusals = Skilled Worker, Visitor; Current = ILR -> Expected = ILR', async () => {
    const client = await createTestClient('T4_Refusals');

    const app = await CandidateApplication.create({
      userId: client.id,
      firstName: client.first_name,
      lastName: client.last_name,
      addressStartDate: '2023-01-01',
      housingStatus: 'Own',
      refusedVisa: 'Yes',
      status: 'submitted',
    });

    // Store multiple refusal records (Issue #6 compliance)
    await syncApplicationVisaRefusals(tenantDb, app.id, client.id, orgId, [
      {
        refusalDate: '2021-05-10',
        country: 'UK',
        visaType: 'Skilled Worker Visa',
        reason: 'Sponsor revocation',
      },
      {
        refusalDate: '2023-02-15',
        country: 'Canada',
        visaType: 'Visitor Visa',
        reason: 'Finance issue',
      },
    ]);

    // Current active case is ILR
    await Case.create({
      caseId: `CAS-706-${counter++}`,
      candidateId: client.id,
      visaTypeId: vtILR.id,
      status: 'Drafting',
      targetSubmissionDate: '2026-12-31',
      organisation_id: orgId,
    });

    const result = await candidateService.getAllCandidates({ search: client.email });
    const clientRow = result.candidates.find((c) => c.id === client.id);

    assert.ok(clientRow);
    assert.equal(clientRow.currentVisaType, 'ILR', 'Refusal history must NOT override current case visa type');

    // Confirm Issue #6 refusal history is still preserved
    const refusals = await CandidateVisaRefusal.findAll({ where: { applicationId: app.id } });
    assert.equal(refusals.length, 2, 'Issue #6 multiple refusals remain intact');
  });

  // =========================================================================
  // TEST 5: No current visa type
  // Current case exists but visa/application type is unavailable.
  // Expected: Existing safe fallback (null / '—'), do NOT display unrelated previous visa
  // =========================================================================
  test('TEST 5 — No current visa type: Current case exists with null visaTypeId -> Expected = null / fallback', async () => {
    const client = await createTestClient('T5_NoVisaType');

    // Old application had a holding visa
    await CandidateApplication.create({
      userId: client.id,
      firstName: client.first_name,
      lastName: client.last_name,
      addressStartDate: '2023-01-01',
      housingStatus: 'Own',
      visaType: 'Old Irrelevant Visa',
      status: 'draft',
    });

    // Case exists but visaTypeId is null
    await Case.create({
      caseId: `CAS-707-${counter++}`,
      candidateId: client.id,
      visaTypeId: null,
      status: 'Lead',
      targetSubmissionDate: '2026-12-31',
      organisation_id: orgId,
    });

    const result = await candidateService.getAllCandidates({ search: client.email });
    const clientRow = result.candidates.find((c) => c.id === client.id);

    assert.ok(clientRow);
    assert.equal(clientRow.currentVisaType, null, 'Must be null when case visa type is unavailable');
    // Must NOT fall back to 'Old Irrelevant Visa'
    assert.notEqual(clientRow.currentVisaType, 'Old Irrelevant Visa');
  });

  // =========================================================================
  // TEST 6: Client with only one application / case
  // Application/Case = ILR
  // Expected = ILR
  // =========================================================================
  test('TEST 6 — Client with only one application/case: ILR -> Expected = ILR', async () => {
    const client = await createTestClient('T6_SingleCase');

    await Case.create({
      caseId: `CAS-708-${counter++}`,
      candidateId: client.id,
      visaTypeId: vtILR.id,
      status: 'Submitted',
      targetSubmissionDate: '2026-12-31',
      organisation_id: orgId,
    });

    const result = await candidateService.getAllCandidates({ search: client.email });
    const clientRow = result.candidates.find((c) => c.id === client.id);

    assert.ok(clientRow);
    assert.equal(clientRow.currentVisaType, 'ILR');
  });

  // =========================================================================
  // TEST 7: Client isolation
  // Client A: Current = ILR
  // Client B: Current = Skilled Worker
  // Expected: A -> ILR, B -> Skilled Worker (No cross-client leakage)
  // =========================================================================
  test('TEST 7 — Client isolation: Client A = ILR, Client B = Skilled Worker -> No cross-client leakage', async () => {
    const clientA = await createTestClient('T7_ClientA');
    const clientB = await createTestClient('T7_ClientB');

    await Case.create({
      caseId: `CAS-709-${counter++}`,
      candidateId: clientA.id,
      visaTypeId: vtILR.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      organisation_id: orgId,
    });

    await Case.create({
      caseId: `CAS-710-${counter++}`,
      candidateId: clientB.id,
      visaTypeId: vtSkilledWorker.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      organisation_id: orgId,
    });

    const resA = await candidateService.getAllCandidates({ search: clientA.email });
    const resB = await candidateService.getAllCandidates({ search: clientB.email });

    const rowA = resA.candidates.find((c) => c.id === clientA.id);
    const rowB = resB.candidates.find((c) => c.id === clientB.id);

    assert.equal(rowA.currentVisaType, 'ILR');
    assert.equal(rowB.currentVisaType, 'Skilled Worker Visa');
    assert.notEqual(rowA.currentVisaType, rowB.currentVisaType);
  });

  // =========================================================================
  // TEST 8: Filtering by Visa Type accurately targets CURRENT case
  // When Client has previous Skilled Worker but current ILR:
  // - Filter by ILR -> Client appears
  // - Filter by Skilled Worker -> Client does NOT appear
  // =========================================================================
  test('TEST 8 — Visa type filter matches CURRENT case, not previous history', async () => {
    const client = await createTestClient('T8_FilterTest');

    // Holding visa on application = Skilled Worker
    await CandidateApplication.create({
      userId: client.id,
      firstName: client.first_name,
      lastName: client.last_name,
      addressStartDate: '2023-01-01',
      housingStatus: 'Own',
      visaType: 'Skilled Worker Visa',
      status: 'submitted',
    });

    // Current case = ILR
    await Case.create({
      caseId: `CAS-711-${counter++}`,
      candidateId: client.id,
      visaTypeId: vtILR.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      organisation_id: orgId,
    });

    // Filter by ILR -> must find client
    const resILR = await candidateService.getAllCandidates({ search: client.email, visaType: 'ILR' });
    const matchILR = resILR.candidates.find((c) => c.id === client.id);
    assert.ok(matchILR, 'Client must appear when filtering by current case visa type (ILR)');

    // Filter by Skilled Worker -> must NOT find client
    const resSW = await candidateService.getAllCandidates({ search: client.email, visaType: 'Skilled Worker' });
    const matchSW = resSW.candidates.find((c) => c.id === client.id);
    assert.equal(matchSW, undefined, 'Client must NOT appear when filtering by previous holding visa (Skilled Worker)');
  });

  // =========================================================================
  // CONFIRMATION: Frontend Client list logic verification
  // =========================================================================
  test('CONFIRMATION: Frontend AdminCandidates does not prefer app.visaType over current case', () => {
    const adminCandidatesPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'pages', 'admin', 'AdminCandidates.jsx');
    const adminCandidatesSrc = fs.readFileSync(adminCandidatesPath, 'utf8');

    // Verify resolveCurrentCase is present
    assert.ok(adminCandidatesSrc.includes('function resolveCurrentCase'), 'resolveCurrentCase must be defined in AdminCandidates.jsx');

    // Verify currentVisaType prioritization
    assert.ok(
      adminCandidatesSrc.includes('c.currentVisaType || caseRecord.visaType?.name'),
      'AdminCandidates must prioritize currentVisaType / caseRecord.visaType?.name',
    );

    // Verify old faulty prioritization was removed
    assert.ok(
      !adminCandidatesSrc.includes('app.visaType || caseRecord.visaType?.name'),
      'Faulty app.visaType || caseRecord.visaType?.name priority must be removed',
    );
  });

  // =========================================================================
  // CONFIRMATION: Terminology and 2 Caseworkers Rule preserved
  // =========================================================================
  test('CONFIRMATION: Terminology "Client" preserved and Exactly 2 Caseworkers rule untouched', () => {
    const cwControllerPath = path.join(rootDir, 'Server', 'src', 'modules', 'Caseworker', 'Cases', 'caseworkerCase.controller.js');
    const cwControllerSrc = fs.readFileSync(cwControllerPath, 'utf8');
    assert.ok(
      cwControllerSrc.includes('cwIds.length !== 2'),
      'Backend controller strictly enforces cwIds.length !== 2',
    );
    assert.ok(
      cwControllerSrc.includes('Exactly 2 caseworkers are required per case'),
      'Backend controller message requires exactly 2 caseworkers',
    );

    const adminCandidatesPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'pages', 'admin', 'AdminCandidates.jsx');
    const adminCandidatesSrc = fs.readFileSync(adminCandidatesPath, 'utf8');
    assert.ok(adminCandidatesSrc.includes('RoleBadge role="Client"'), 'Client terminology preserved');
  });
});
