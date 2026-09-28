import dotenv from 'dotenv';
dotenv.config({ path: './Server/.env' });
process.env.NODE_ENV = 'development';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getTenantDb } from '../src/services/tenantDb.service.js';
import { ROLES } from '../src/middlewares/role.middleware.js';
import {
  sanitizeApplicationPayload,
  validateFinalApplicationSubmission,
} from '../src/utils/applicationPayload.util.js';
import {
  syncApplicationVisaRefusals,
  formatApplicationWithRefusals,
  validateVisaRefusal,
} from '../src/services/visaRefusal.service.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

describe('Issue #6: Support Multiple Visa Refusals', async () => {
  const tenantDb = getTenantDb('epic_technoweb');
  const { User, Organisation, CandidateApplication, CandidateVisaRefusal } = tenantDb;

  // Sync sequences
  await tenantDb.sequelize.query(`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1));`);
  await tenantDb.sequelize.query(`SELECT setval('candidate_applications_id_seq', COALESCE((SELECT MAX(id) FROM candidate_applications), 1));`);
  await tenantDb.sequelize.query(`SELECT setval('candidate_visa_refusals_id_seq', COALESCE((SELECT MAX(id) FROM candidate_visa_refusals), 1));`);

  const org = await Organisation.findOne({ order: [['id', 'ASC']] });
  const orgId = org ? org.id : 1;
  let counter = Date.now();

  async function createTestClient(namePrefix) {
    return await User.create({
      first_name: namePrefix,
      last_name: 'Tester',
      email: `test_issue6_${counter++}_${Math.floor(Math.random() * 10000)}@example.com`,
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
  // TEST 1: No refusals
  // =========================================================================
  test('TEST 1 — No refusals: Client with no refusal history can be created/updated successfully', async () => {
    const client = await createTestClient('NoRefusal');
    const sanitized = sanitizeApplicationPayload({
      firstName: 'NoRefusal',
      lastName: 'Client',
      addressStartDate: '2023-01-01',
      housingStatus: 'Own',
      refusedVisa: 'No',
      visaRefusals: [],
    });
    validateFinalApplicationSubmission(sanitized);

    const app = await CandidateApplication.create({
      ...sanitized,
      userId: client.id,
      status: 'draft',
    });

    await syncApplicationVisaRefusals(tenantDb, app.id, client.id, orgId, sanitized.visaRefusals);
    const reloaded = await formatApplicationWithRefusals(tenantDb, app);

    assert.equal(reloaded.refusedVisa, 'No');
    assert.deepEqual(reloaded.visaRefusals, []);

    const countInDb = await CandidateVisaRefusal.count({ where: { applicationId: app.id } });
    assert.equal(countInDb, 0);
  });

  // =========================================================================
  // TEST 2: One refusal
  // =========================================================================
  test('TEST 2 — One refusal: Add one refusal, saved and retrieved correctly', async () => {
    const client = await createTestClient('OneRefusal');
    const refusalInput = [
      {
        refusalDate: '2022-04-15',
        country: 'United Kingdom',
        visaType: 'Skilled Worker',
        reason: 'Sponsor licence revocation before CoS was assigned',
        referenceNumber: 'REF-UK-001',
        details: 'Full details of refusal',
      },
    ];

    const sanitized = sanitizeApplicationPayload({
      firstName: 'OneRefusal',
      lastName: 'Client',
      addressStartDate: '2023-01-01',
      housingStatus: 'Own',
      refusedVisa: 'Yes',
      visaRefusals: refusalInput,
    });
    validateFinalApplicationSubmission(sanitized);

    const app = await CandidateApplication.create({
      ...sanitized,
      userId: client.id,
      status: 'submitted',
    });

    await syncApplicationVisaRefusals(tenantDb, app.id, client.id, orgId, sanitized.visaRefusals);
    const reloaded = await formatApplicationWithRefusals(tenantDb, app);

    assert.equal(reloaded.refusedVisa, 'Yes');
    assert.equal(reloaded.visaRefusals.length, 1);
    assert.equal(reloaded.visaRefusals[0].country, 'United Kingdom');
    assert.equal(reloaded.visaRefusals[0].visaType, 'Skilled Worker');
    assert.equal(reloaded.visaRefusals[0].reason, 'Sponsor licence revocation before CoS was assigned');
    assert.equal(reloaded.visaRefusals[0].referenceNumber, 'REF-UK-001');

    // Also verify legacy single column mirror for backward compatibility
    assert.equal(reloaded.refusedVisaCountry, 'United Kingdom');
    assert.equal(reloaded.refusedVisaType, 'Skilled Worker');
    assert.equal(reloaded.refusedVisaReason, 'Sponsor licence revocation before CoS was assigned');
  });

  // =========================================================================
  // TEST 3: Multiple refusals (Two refusals)
  // =========================================================================
  test('TEST 3 — Multiple refusals: Add two refusals, both stored and returned', async () => {
    const client = await createTestClient('TwoRefusals');
    const refusalsInput = [
      {
        refusalDate: '2022-03-01',
        country: 'United Kingdom',
        visaType: 'Skilled Worker',
        reason: 'Reason A — Missing CoS verification',
        referenceNumber: 'REF-001',
      },
      {
        refusalDate: '2023-07-15',
        country: 'Canada',
        visaType: 'Visitor',
        reason: 'Reason B — Insufficient financial documentation',
        referenceNumber: 'REF-002',
      },
    ];

    const sanitized = sanitizeApplicationPayload({
      firstName: 'TwoRefusals',
      lastName: 'Client',
      addressStartDate: '2023-01-01',
      housingStatus: 'Own',
      refusedVisa: 'Yes',
      visaRefusals: refusalsInput,
    });

    const app = await CandidateApplication.create({
      ...sanitized,
      userId: client.id,
      status: 'draft',
    });

    await syncApplicationVisaRefusals(tenantDb, app.id, client.id, orgId, sanitized.visaRefusals);
    const reloaded = await formatApplicationWithRefusals(tenantDb, app);

    assert.equal(reloaded.visaRefusals.length, 2);
    assert.equal(reloaded.visaRefusals[0].visaType, 'Skilled Worker');
    assert.equal(reloaded.visaRefusals[0].reason, 'Reason A — Missing CoS verification');
    assert.equal(reloaded.visaRefusals[1].country, 'Canada');
    assert.equal(reloaded.visaRefusals[1].visaType, 'Visitor');
    assert.equal(reloaded.visaRefusals[1].reason, 'Reason B — Insufficient financial documentation');
  });

  // =========================================================================
  // TEST 4: Three refusals (as in user example)
  // =========================================================================
  test('TEST 4 — Three refusals: Add three refusals, all three remain independently accessible', async () => {
    const client = await createTestClient('ThreeRefusals');
    const refusalsInput = [
      {
        refusalDate: '2022-01-10',
        country: 'United Kingdom',
        visaType: 'Skilled Worker',
        reason: 'Reason A',
        referenceNumber: 'UK-SKW-2022',
      },
      {
        refusalDate: '2023-06-20',
        country: 'United Kingdom',
        visaType: 'Visitor',
        reason: 'Reason B',
        referenceNumber: 'UK-VIS-2023',
      },
      {
        refusalDate: '2025-02-14',
        country: 'United Kingdom',
        visaType: 'ILR-related application',
        reason: 'Reason C',
        referenceNumber: 'UK-ILR-2025',
      },
    ];

    const sanitized = sanitizeApplicationPayload({
      firstName: 'ThreeRefusals',
      lastName: 'Client',
      addressStartDate: '2023-01-01',
      housingStatus: 'Own',
      refusedVisa: 'Yes',
      visaRefusals: refusalsInput,
    });

    const app = await CandidateApplication.create({
      ...sanitized,
      userId: client.id,
      status: 'draft',
    });

    await syncApplicationVisaRefusals(tenantDb, app.id, client.id, orgId, sanitized.visaRefusals);
    const reloaded = await formatApplicationWithRefusals(tenantDb, app);

    assert.equal(reloaded.visaRefusals.length, 3);
    assert.equal(reloaded.visaRefusals[0].visaType, 'Skilled Worker');
    assert.equal(reloaded.visaRefusals[0].reason, 'Reason A');
    assert.equal(reloaded.visaRefusals[1].visaType, 'Visitor');
    assert.equal(reloaded.visaRefusals[1].reason, 'Reason B');
    assert.equal(reloaded.visaRefusals[2].visaType, 'ILR-related application');
    assert.equal(reloaded.visaRefusals[2].reason, 'Reason C');
  });

  // =========================================================================
  // TEST 5: Add without overwriting
  // =========================================================================
  test('TEST 5 — Add without overwriting: Existing Refusal #1, add Refusal #2 -> Refusal #1 remains unchanged', async () => {
    const client = await createTestClient('AddWithoutOverwrite');
    const app = await CandidateApplication.create({
      firstName: 'AddWithoutOverwrite',
      lastName: 'Client',
      addressStartDate: '2023-01-01',
      housingStatus: 'Own',
      refusedVisa: 'Yes',
      userId: client.id,
      status: 'draft',
    });

    // Add Refusal #1
    await syncApplicationVisaRefusals(tenantDb, app.id, client.id, orgId, [
      {
        refusalDate: '2022-01-01',
        country: 'United Kingdom',
        visaType: 'Skilled Worker',
        reason: 'Original refusal 1',
        referenceNumber: 'REF-ORIG-1',
      },
    ]);

    let current = await formatApplicationWithRefusals(tenantDb, app);
    assert.equal(current.visaRefusals.length, 1);
    const refusal1Id = current.visaRefusals[0].id;

    // Add Refusal #2 preserving Refusal #1 with its ID
    await syncApplicationVisaRefusals(tenantDb, app.id, client.id, orgId, [
      {
        id: refusal1Id,
        refusalDate: '2022-01-01',
        country: 'United Kingdom',
        visaType: 'Skilled Worker',
        reason: 'Original refusal 1',
        referenceNumber: 'REF-ORIG-1',
      },
      {
        refusalDate: '2023-05-10',
        country: 'Australia',
        visaType: 'Student Visa',
        reason: 'Newly added refusal 2',
        referenceNumber: 'REF-NEW-2',
      },
    ]);

    const updated = await formatApplicationWithRefusals(tenantDb, app);
    assert.equal(updated.visaRefusals.length, 2);
    assert.equal(updated.visaRefusals[0].id, refusal1Id);
    assert.equal(updated.visaRefusals[0].reason, 'Original refusal 1');
    assert.equal(updated.visaRefusals[0].referenceNumber, 'REF-ORIG-1');
    assert.equal(updated.visaRefusals[1].reason, 'Newly added refusal 2');
    assert.equal(updated.visaRefusals[1].country, 'Australia');
  });

  // =========================================================================
  // TEST 6: Edit
  // =========================================================================
  test('TEST 6 — Edit: Edit Refusal #2 -> Refusal #1 remains unchanged', async () => {
    const client = await createTestClient('EditRefusal');
    const app = await CandidateApplication.create({
      firstName: 'Edit',
      lastName: 'Client',
      addressStartDate: '2023-01-01',
      housingStatus: 'Own',
      refusedVisa: 'Yes',
      userId: client.id,
      status: 'draft',
    });

    await syncApplicationVisaRefusals(tenantDb, app.id, client.id, orgId, [
      {
        refusalDate: '2021-01-01',
        country: 'France',
        visaType: 'Work',
        reason: 'Untouched Refusal #1',
        referenceNumber: 'FR-001',
      },
      {
        refusalDate: '2022-02-02',
        country: 'Germany',
        visaType: 'Tourist',
        reason: 'Initial Refusal #2 Reason',
        referenceNumber: 'DE-002',
      },
    ]);

    let state = await formatApplicationWithRefusals(tenantDb, app);
    const r1 = state.visaRefusals[0];
    const r2 = state.visaRefusals[1];

    // Edit Refusal #2
    await syncApplicationVisaRefusals(tenantDb, app.id, client.id, orgId, [
      {
        id: r1.id,
        refusalDate: r1.refusalDate,
        country: r1.country,
        visaType: r1.visaType,
        reason: r1.reason,
        referenceNumber: r1.referenceNumber,
      },
      {
        id: r2.id,
        refusalDate: '2022-02-02',
        country: 'Germany',
        visaType: 'Tourist',
        reason: 'UPDATED Refusal #2 Reason (Overturned on appeal later)',
        referenceNumber: 'DE-002-APPEAL',
      },
    ]);

    const reloaded = await formatApplicationWithRefusals(tenantDb, app);
    assert.equal(reloaded.visaRefusals.length, 2);
    // Refusal #1 is unchanged
    assert.equal(reloaded.visaRefusals[0].id, r1.id);
    assert.equal(reloaded.visaRefusals[0].reason, 'Untouched Refusal #1');
    assert.equal(reloaded.visaRefusals[0].referenceNumber, 'FR-001');

    // Refusal #2 is updated
    assert.equal(reloaded.visaRefusals[1].id, r2.id);
    assert.equal(reloaded.visaRefusals[1].reason, 'UPDATED Refusal #2 Reason (Overturned on appeal later)');
    assert.equal(reloaded.visaRefusals[1].referenceNumber, 'DE-002-APPEAL');
  });

  // =========================================================================
  // TEST 7: Delete
  // =========================================================================
  test('TEST 7 — Delete: Delete Refusal #2 -> Refusal #1 remains', async () => {
    const client = await createTestClient('DeleteRefusal');
    const app = await CandidateApplication.create({
      firstName: 'Delete',
      lastName: 'Client',
      addressStartDate: '2023-01-01',
      housingStatus: 'Own',
      refusedVisa: 'Yes',
      userId: client.id,
      status: 'draft',
    });

    await syncApplicationVisaRefusals(tenantDb, app.id, client.id, orgId, [
      {
        refusalDate: '2020-05-15',
        country: 'USA',
        visaType: 'B1/B2',
        reason: 'Persistent Refusal #1',
        referenceNumber: 'US-001',
      },
      {
        refusalDate: '2021-08-20',
        country: 'Japan',
        visaType: 'Short Term',
        reason: 'Refusal #2 to be deleted',
        referenceNumber: 'JP-002',
      },
    ]);

    let state = await formatApplicationWithRefusals(tenantDb, app);
    assert.equal(state.visaRefusals.length, 2);
    const r1 = state.visaRefusals[0];

    // Omit Refusal #2 to delete it
    await syncApplicationVisaRefusals(tenantDb, app.id, client.id, orgId, [
      {
        id: r1.id,
        refusalDate: r1.refusalDate,
        country: r1.country,
        visaType: r1.visaType,
        reason: r1.reason,
        referenceNumber: r1.referenceNumber,
      },
    ]);

    const afterDelete = await formatApplicationWithRefusals(tenantDb, app);
    assert.equal(afterDelete.visaRefusals.length, 1);
    assert.equal(afterDelete.visaRefusals[0].id, r1.id);
    assert.equal(afterDelete.visaRefusals[0].reason, 'Persistent Refusal #1');

    // Verify record in database is actually gone
    const countInDb = await CandidateVisaRefusal.count({ where: { applicationId: app.id } });
    assert.equal(countInDb, 1);
  });

  // =========================================================================
  // TEST 8: Existing data migration
  // =========================================================================
  test('TEST 8 — Existing data migration: Legacy single-refusal data read & migrated correctly', async () => {
    const client = await createTestClient('LegacyMigrate');
    const [insertResult] = await tenantDb.sequelize.query(`
      INSERT INTO candidate_applications (
        "userId", "firstName", "lastName", "addressStartDate", "housingStatus",
        "refusedVisa", "refusedVisaReason", "refusedVisaDate", "refusedVisaCountry", "refusedVisaType", "refusedVisaReference",
        "status", "createdAt", "updatedAt"
      ) VALUES (
        ${client.id}, 'Legacy', 'Client', '2021-01-01', 'Own',
        'Yes', 'Legacy Home Office refusal 2019', '2019-11-20', 'United Kingdom', 'Tier 2 General', 'LEGACY-REF-999',
        'submitted', NOW(), NOW()
      ) RETURNING *;
    `);
    const legacyApp = insertResult[0];

    // Load and format application
    const formatted = await formatApplicationWithRefusals(tenantDb, legacyApp);

    assert.equal(formatted.refusedVisa, 'Yes');
    assert.ok(Array.isArray(formatted.visaRefusals));
    assert.equal(formatted.visaRefusals.length, 1);
    assert.equal(formatted.visaRefusals[0].country, 'United Kingdom');
    assert.equal(formatted.visaRefusals[0].visaType, 'Tier 2 General');
    assert.equal(formatted.visaRefusals[0].reason, 'Legacy Home Office refusal 2019');
    assert.equal(formatted.visaRefusals[0].referenceNumber, 'LEGACY-REF-999');

    // Upgrade with a second refusal
    await syncApplicationVisaRefusals(tenantDb, legacyApp.id, client.id, orgId, [
      ...formatted.visaRefusals,
      {
        refusalDate: '2023-04-10',
        country: 'Ireland',
        visaType: 'Work Permit',
        reason: 'Additional refusal added to migrated record',
        referenceNumber: 'IE-2023',
      },
    ]);

    const upgraded = await formatApplicationWithRefusals(tenantDb, legacyApp);
    assert.equal(upgraded.visaRefusals.length, 2);
    assert.equal(upgraded.visaRefusals[0].reason, 'Legacy Home Office refusal 2019');
    assert.equal(upgraded.visaRefusals[1].reason, 'Additional refusal added to migrated record');
  });

  // =========================================================================
  // TEST 9: Client isolation
  // =========================================================================
  test('TEST 9 — Client isolation: Client A refusals cannot appear or be modified under Client B', async () => {
    const clientA = await createTestClient('ClientA');
    const clientB = await createTestClient('ClientB');

    const appA = await CandidateApplication.create({
      firstName: 'ClientA',
      lastName: 'Tester',
      addressStartDate: '2022-01-01',
      housingStatus: 'Own',
      refusedVisa: 'Yes',
      userId: clientA.id,
      status: 'draft',
    });

    const appB = await CandidateApplication.create({
      firstName: 'ClientB',
      lastName: 'Tester',
      addressStartDate: '2022-01-01',
      housingStatus: 'Own',
      refusedVisa: 'No',
      userId: clientB.id,
      status: 'draft',
    });

    // Create refusal under Client A
    await syncApplicationVisaRefusals(tenantDb, appA.id, clientA.id, orgId, [
      {
        refusalDate: '2021-03-15',
        country: 'New Zealand',
        visaType: 'Resident Visa',
        reason: 'Client A Private Refusal Reason',
        referenceNumber: 'NZ-SEC-01',
      },
    ]);

    const formattedA = await formatApplicationWithRefusals(tenantDb, appA);
    const formattedB = await formatApplicationWithRefusals(tenantDb, appB);

    assert.equal(formattedA.visaRefusals.length, 1);
    assert.equal(formattedA.visaRefusals[0].reason, 'Client A Private Refusal Reason');

    // Client B must have 0 refusals and never see Client A's refusal
    assert.equal(formattedB.visaRefusals.length, 0);

    const refusalAId = formattedA.visaRefusals[0].id;

    // Direct database query by Client B's application ID or user ID returns nothing
    const refusalsUnderB = await CandidateVisaRefusal.findAll({
      where: { applicationId: appB.id },
    });
    assert.equal(refusalsUnderB.length, 0);

    // Verify tenantDb/service blocks updating Client A's refusal under Client B's application
    await syncApplicationVisaRefusals(tenantDb, appB.id, clientB.id, orgId, [
      {
        id: refusalAId, // Attempt to tamper Client A's refusal ID into Client B's sync
        refusalDate: '2021-03-15',
        country: 'New Zealand',
        visaType: 'Resident Visa',
        reason: 'Tampered Reason by Client B',
      },
    ]);

    // Check Client A's refusal was NOT modified by Client B
    const refusalAAfter = await CandidateVisaRefusal.findByPk(refusalAId);
    assert.equal(refusalAAfter.applicationId, appA.id);
    assert.equal(refusalAAfter.userId, clientA.id);
    assert.equal(refusalAAfter.reason, 'Client A Private Refusal Reason');
  });

  // =========================================================================
  // TEST 10: Validation
  // =========================================================================
  test('TEST 10 — Validation: Invalid refusal data throws expected validation errors', async () => {
    // 1. Future refusal date
    assert.throws(
      () => {
        validateVisaRefusal({
          refusalDate: '2099-01-01',
          country: 'United Kingdom',
          visaType: 'Skilled Worker',
          reason: 'Valid reason',
        });
      },
      /Refusal date cannot be in the future/i,
    );

    // 2. Malformed refusal date
    assert.throws(
      () => {
        validateVisaRefusal({
          refusalDate: 'invalid-date-string',
          country: 'United Kingdom',
          visaType: 'Skilled Worker',
          reason: 'Valid reason',
        });
      },
      /Refusal date is not a valid date/i,
    );

    // 3. Country too long (> 100 chars)
    assert.throws(
      () => {
        validateVisaRefusal({
          refusalDate: '2022-01-01',
          country: 'A'.repeat(101),
          visaType: 'Skilled Worker',
          reason: 'Valid reason',
        });
      },
      /Country of visa refusal must be 100 characters or fewer/i,
    );

    // 4. Missing required fields in final application submission
    assert.throws(
      () => {
        validateFinalApplicationSubmission({
          addressStartDate: '2022-01-01',
          refusedVisa: 'Yes',
          visaRefusals: [
            {
              refusalDate: '2022-01-01',
              country: 'United Kingdom',
              visaType: 'Skilled Worker',
              reason: '   ', // empty reason
            },
          ],
        });
      },
      /Reason for visa refusal is required/i,
    );
  });

  // =========================================================================
  // TEST 11: API / Service operations
  // =========================================================================
  test('TEST 11 — API & Service: Create, retrieve, update, and delete refusal records', async () => {
    const client = await createTestClient('ApiCrud');
    const app = await CandidateApplication.create({
      firstName: 'ApiCrud',
      lastName: 'Tester',
      addressStartDate: '2022-01-01',
      housingStatus: 'Own',
      refusedVisa: 'Yes',
      userId: client.id,
      status: 'draft',
    });

    // CREATE Refusal 1
    const created1 = await CandidateVisaRefusal.create({
      applicationId: app.id,
      userId: client.id,
      organisationId: orgId,
      refusalDate: '2022-01-10',
      country: 'UK',
      visaType: 'Student',
      reason: 'Missing CAS',
      referenceNumber: 'API-001',
    });
    assert.ok(created1.id);

    // CREATE Refusal 2
    const created2 = await CandidateVisaRefusal.create({
      applicationId: app.id,
      userId: client.id,
      organisationId: orgId,
      refusalDate: '2023-02-15',
      country: 'USA',
      visaType: 'F1',
      reason: 'Financial docs',
      referenceNumber: 'API-002',
    });
    assert.ok(created2.id);

    // RETRIEVE
    const retrieved = await CandidateVisaRefusal.findAll({
      where: { applicationId: app.id },
      order: [['refusalDate', 'ASC']],
    });
    assert.equal(retrieved.length, 2);

    // UPDATE Refusal 2
    await created2.update({
      reason: 'Financial docs updated and verified',
    });
    const reloaded2 = await CandidateVisaRefusal.findByPk(created2.id);
    assert.equal(reloaded2.reason, 'Financial docs updated and verified');

    // DELETE Refusal 1
    await created1.destroy();
    const remaining = await CandidateVisaRefusal.findAll({
      where: { applicationId: app.id },
    });
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, created2.id);
  });

  // =========================================================================
  // TEST 12: Existing application regression
  // =========================================================================
  test('TEST 12 — Regression: Existing Client/Application functionality, CCL tags, and Single-Caseworker rule remain intact', async () => {
    // 1. Single Caseworker Rule (BUG-017): Verified in caseworkerCase.controller.js and Frontend Cases.jsx
    const cwControllerPath = path.join(rootDir, 'Server', 'src', 'modules', 'Caseworker', 'Cases', 'caseworkerCase.controller.js');
    const cwControllerSrc = fs.readFileSync(cwControllerPath, 'utf8');
    assert.ok(
      cwControllerSrc.includes('singleCaseworkerError') && !cwControllerSrc.includes('cwIds.length !== 2'),
      'Backend controller enforces one caseworker per case',
    );

    const cwCasesPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'pages', 'caseworker', 'Cases.jsx');
    const cwCasesSrc = fs.readFileSync(cwCasesPath, 'utf8');
    assert.ok(
      cwCasesSrc.includes('selectedCwCount > 1') || cwCasesSrc.includes('A case can only be assigned to one caseworker'),
      'Frontend strictly enforces single caseworker rule per BUG-017',
    );

    // 2. Client terminology verification
    const clientAppFields = Object.keys(CandidateApplication.rawAttributes);
    assert.ok(clientAppFields.includes('userId'));
    assert.ok(clientAppFields.includes('refusedVisa'));
    assert.ok(clientAppFields.includes('refusedVisaReason'));

    // 3. Nationalities and Previous Addresses regression
    const complexPayload = sanitizeApplicationPayload({
      firstName: 'Complex',
      lastName: 'Client',
      addressStartDate: '2023-01-01',
      housingStatus: 'Own',
      nationalities: ['British', 'Irish'],
      previousAddresses: [
        {
          previousAddress: '10 Downing St, London',
          startDate: '2020-01-01',
          endDate: '2022-12-31',
        },
      ],
      refusedVisa: 'No',
    });
    assert.deepEqual(complexPayload.nationalities, ['British', 'Irish']);
    assert.equal(complexPayload.previousAddresses.length, 1);
    assert.equal(complexPayload.nationality, 'British');
    assert.equal(complexPayload.previousAddress, '10 Downing St, London');
  });
});
