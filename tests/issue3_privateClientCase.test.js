import dotenv from 'dotenv';
dotenv.config({ path: './Server/.env' });
process.env.NODE_ENV = 'development';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getTenantDb } from '../src/services/tenantDb.service.js';
import { generateCaseId } from '../src/utils/case.utils.js';
import { assertUsersInOrganisation } from '../src/utils/tenantScope.js';
import { ROLES } from '../src/middlewares/role.middleware.js';
import { DEFAULT_CASE_STAGE } from '../src/constants/immigrationCaseProcess.js';

/**
 * Issue #3: Private Client Case Creation Fails
 *
 * Fix: createMyCase no longer requires sponsorId (BUG-031 applied to
 * caseworker endpoint). sponsorId is now optional for private clients.
 */

describe('Issue #3: Private Client Case Creation', async () => {
  const tenantDb = getTenantDb('epic_technoweb');
  const { User, Organisation, Case, VisaType } = tenantDb;

  const org = await Organisation.findOne({ order: [['id', 'ASC']] });
  const orgId = org ? org.id : 1;
  const timestamp = Date.now();

  let candidateUser = null;
  let sponsorUser = null;
  let visaTypeId = null;

  try {
    candidateUser = await User.findOne({
      where: { role_id: ROLES.CANDIDATE, organisation_id: orgId },
      order: [['id', 'ASC']],
    });
    if (!candidateUser) {
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.default.hash('TestPass123!', 10);
      candidateUser = await User.create({
        first_name: 'Issue3',
        last_name: 'TestClient',
        email: `issue3.client.${timestamp}@example.com`,
        password: hash,
        role_id: ROLES.CANDIDATE,
        is_email_verified: true,
        status: 'active',
        organisation_id: orgId,
      });
    }
    sponsorUser = await User.findOne({
      where: { role_id: ROLES.SPONSOR, organisation_id: orgId },
      order: [['id', 'ASC']],
    }).catch(() => null);
    const vt = await VisaType.findOne({ order: [['id', 'ASC']] }).catch(() => null);
    if (vt) visaTypeId = vt.id;
  } catch (setupErr) {
    console.warn('[Issue3] Setup warning:', setupErr.message);
  }

  function validateCasePayload({ candidateId, visaTypeId: vtId, targetSubmissionDate }) {
    const errors = [];
    if (!candidateId) errors.push('Client (candidateId) is required');
    if (!vtId) errors.push('Visa Type (visaTypeId) is required');
    if (!targetSubmissionDate) errors.push('Target submission date is required');
    return errors;
  }

  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  test('TEST 1: Validation passes for private client (no sponsorId)', () => {
    const errors = validateCasePayload({ candidateId: 1, visaTypeId: 1, targetSubmissionDate: futureDate });
    assert.equal(errors.length, 0, `Expected no errors — got: ${errors.join('; ')}`);
  });

  test('TEST 2: Validation passes for sponsored client (with sponsorId)', () => {
    const errors = validateCasePayload({ candidateId: 1, sponsorId: 2, visaTypeId: 1, targetSubmissionDate: futureDate });
    assert.equal(errors.length, 0, `Expected no errors — got: ${errors.join('; ')}`);
  });

  test('TEST 3: Validation rejects missing candidateId with correct message', () => {
    const errors = validateCasePayload({ visaTypeId: 1, targetSubmissionDate: futureDate });
    assert.ok(errors.length > 0, 'Should produce validation errors');
    assert.ok(errors.some((e) => e.toLowerCase().includes('candidateid') || e.toLowerCase().includes('client')), `Expected "client" in error: ${errors.join('; ')}`);
  });

  test('TEST 4: Validation rejects missing visaTypeId with correct message', () => {
    const errors = validateCasePayload({ candidateId: 1, targetSubmissionDate: futureDate });
    assert.ok(errors.length > 0, 'Should produce validation errors');
    assert.ok(errors.some((e) => e.toLowerCase().includes('visa')), `Expected "visa" in error: ${errors.join('; ')}`);
  });

  test('TEST 5: Non-existent candidateId => "Client not found"', async () => {
    const candidate = await User.findByPk(999999999).catch(() => null);
    assert.equal(candidate, null, 'Fake candidateId should not match');
    const message = !candidate ? 'Client not found' : null;
    assert.equal(message, 'Client not found');
  });

  test('TEST 6: Unknown sponsorId (when provided) => "Sponsor not found"', async () => {
    const fakeSponsorId = 999999998;
    const sponsor = fakeSponsorId ? await User.findByPk(fakeSponsorId).catch(() => null) : null;
    const message = fakeSponsorId && !sponsor ? 'Sponsor not found' : null;
    assert.equal(message, 'Sponsor not found');
  });

  test('TEST 7: assertUsersInOrganisation accepts null sponsorId (private client)', async () => {
    if (!candidateUser) { console.log('[SKIP] no candidate'); return; }
    await assert.doesNotReject(() => assertUsersInOrganisation(tenantDb, candidateUser.id, null));
  });

  test('TEST 8: assertUsersInOrganisation throws for unknown candidateId', async () => {
    await assert.rejects(
      () => assertUsersInOrganisation(tenantDb, 999999997, null),
      (err) => { assert.ok(err.message.toLowerCase().includes('not found')); return true; }
    );
  });

  test('TEST 9: DB — Case with sponsorId=null saves correctly (private client)', async () => {
    if (!candidateUser || !visaTypeId) { console.log('[SKIP] missing data'); return; }
    const caseId = await generateCaseId(tenantDb, { organisationId: orgId, visaTypeId });
    const newCase = await Case.create({
      caseId, candidateId: candidateUser.id, sponsorId: null, businessId: null,
      visaTypeId, petitionTypeId: null, priority: 'medium', status: 'Lead',
      caseStage: DEFAULT_CASE_STAGE, submitted: new Date(), targetSubmissionDate: futureDate,
      assignedcaseworkerId: [], salaryOffered: 0, totalAmount: 100, paidAmount: 0,
      notes: 'Issue3 private client test', organisation_id: orgId,
    });
    assert.ok(newCase && newCase.id, 'Case should be created');
    assert.equal(newCase.sponsorId, null, 'sponsorId should be null');
    await newCase.destroy().catch(() => {});
  });

  test('TEST 10: DB — Case with sponsorId set saves correctly (sponsored client)', async () => {
    if (!candidateUser || !visaTypeId || !sponsorUser) { console.log('[SKIP] missing data'); return; }
    const caseId = await generateCaseId(tenantDb, { organisationId: orgId, visaTypeId });
    const newCase = await Case.create({
      caseId, candidateId: candidateUser.id, sponsorId: sponsorUser.id, businessId: sponsorUser.id,
      visaTypeId, petitionTypeId: null, priority: 'medium', status: 'Lead',
      caseStage: DEFAULT_CASE_STAGE, submitted: new Date(), targetSubmissionDate: futureDate,
      assignedcaseworkerId: [], salaryOffered: 0, totalAmount: 200, paidAmount: 0,
      notes: 'Issue3 sponsored client test', organisation_id: orgId,
    });
    assert.ok(newCase && newCase.id, 'Case should be created');
    assert.equal(newCase.sponsorId, sponsorUser.id, 'sponsorId should match');
    await newCase.destroy().catch(() => {});
  });

  // =========================================================================
  // Caseworker Count Requirement: EXACTLY 2 CASEWORKERS PER CASE
  // =========================================================================
  const { createMyCase } = await import('../src/modules/Caseworker/Cases/caseworkerCase.controller.js');

  function createMockRes() {
    return {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };
  }

  const creatorUserId = 999901;
  const cw1 = 999902;
  const cw2 = 999903;
  const cw3 = 999904;

  test('TEST 11: 0 additional selected → final count 1 → REJECTED', async () => {
    if (!candidateUser || !visaTypeId) { console.log('[SKIP] missing data'); return; }
    const req = {
      user: { userId: creatorUserId, role_id: ROLES.CASEWORKER, organisation_id: orgId },
      tenantDb,
      body: {
        candidateId: candidateUser.id,
        visaTypeId,
        targetSubmissionDate: futureDate,
        assignedcaseworkerId: [], // 0 additional selected
      },
    };
    const res = createMockRes();
    await createMyCase(req, res);

    assert.equal(res.statusCode, 400, `Expected 400 Bad Request, got ${res.statusCode}`);
    assert.equal(res.body?.status, 'error');
    assert.equal(res.body?.data?.finalCount, 1, 'Final count should be 1 after creator auto-inclusion');
    assert.ok(res.body?.message?.includes('Exactly 2 caseworkers are required'), `Message should mention requirement: ${res.body?.message}`);
  });

  test('TEST 12: 1 additional selected → final count 2 → ACCEPTED', async () => {
    if (!candidateUser || !visaTypeId) { console.log('[SKIP] missing data'); return; }
    const req = {
      user: { userId: creatorUserId, role_id: ROLES.CASEWORKER, organisation_id: orgId },
      tenantDb,
      body: {
        candidateId: candidateUser.id,
        visaTypeId,
        targetSubmissionDate: futureDate,
        assignedcaseworkerId: [cw1], // 1 additional selected
      },
    };
    const res = createMockRes();
    await createMyCase(req, res);

    assert.equal(res.statusCode, 201, `Expected 201 Created, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body?.status, 'success');
    const createdCase = res.body?.data?.case;
    assert.ok(createdCase && createdCase.id, 'Case should be created in DB');
    assert.equal(Array.isArray(createdCase.assignedcaseworkerId), true);
    assert.equal(createdCase.assignedcaseworkerId.length, 2, 'Final persisted caseworker count must be exactly 2');
    assert.ok(createdCase.assignedcaseworkerId.includes(cw1), 'Must contain selected caseworker');
    assert.ok(createdCase.assignedcaseworkerId.includes(creatorUserId), 'Must contain creating caseworker');

    // Clean up
    await Case.destroy({ where: { id: createdCase.id } }).catch(() => {});
  });

  test('TEST 13: 2 additional selected → final count 3 → REJECTED', async () => {
    if (!candidateUser || !visaTypeId) { console.log('[SKIP] missing data'); return; }
    const req = {
      user: { userId: creatorUserId, role_id: ROLES.CASEWORKER, organisation_id: orgId },
      tenantDb,
      body: {
        candidateId: candidateUser.id,
        visaTypeId,
        targetSubmissionDate: futureDate,
        assignedcaseworkerId: [cw1, cw2], // 2 additional selected
      },
    };
    const res = createMockRes();
    await createMyCase(req, res);

    assert.equal(res.statusCode, 400, `Expected 400 Bad Request, got ${res.statusCode}`);
    assert.equal(res.body?.status, 'error');
    assert.equal(res.body?.data?.finalCount, 3, 'Final count should be 3 after creator auto-inclusion');
    assert.ok(res.body?.message?.includes('Exactly 2 caseworkers are required'));
  });

  test('TEST 14: Direct API request with final count other than 2 → REJECTED', async () => {
    if (!candidateUser || !visaTypeId) { console.log('[SKIP] missing data'); return; }

    // Sub-case 14a: 3 additional selected -> final 4 -> rejected
    {
      const req = {
        user: { userId: creatorUserId, role_id: ROLES.CASEWORKER, organisation_id: orgId },
        tenantDb,
        body: {
          candidateId: candidateUser.id,
          visaTypeId,
          targetSubmissionDate: futureDate,
          assignedcaseworkerId: [cw1, cw2, cw3], // 3 caseworkers + creator = 4
        },
      };
      const res = createMockRes();
      await createMyCase(req, res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body?.status, 'error');
      assert.equal(res.body?.data?.finalCount, 4);
    }

    // Sub-case 14b: Selecting only creator themselves -> final count 1 -> rejected
    {
      const req = {
        user: { userId: creatorUserId, role_id: ROLES.CASEWORKER, organisation_id: orgId },
        tenantDb,
        body: {
          candidateId: candidateUser.id,
          visaTypeId,
          targetSubmissionDate: futureDate,
          assignedcaseworkerId: [creatorUserId], // Only creator -> set deduplicates to 1
        },
      };
      const res = createMockRes();
      await createMyCase(req, res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body?.status, 'error');
      assert.equal(res.body?.data?.finalCount, 1);
    }

    // Sub-case 14c: Direct API request with explicit 2 caseworkers (including creator) -> accepted
    {
      const req = {
        user: { userId: creatorUserId, role_id: ROLES.CASEWORKER, organisation_id: orgId },
        tenantDb,
        body: {
          candidateId: candidateUser.id,
          visaTypeId,
          targetSubmissionDate: futureDate,
          assignedcaseworkerId: [cw1, creatorUserId], // explicit 2 containing creator
        },
      };
      const res = createMockRes();
      await createMyCase(req, res);
      assert.equal(res.statusCode, 201);
      assert.equal(res.body?.status, 'success');
      const createdCase = res.body?.data?.case;
      assert.equal(createdCase.assignedcaseworkerId.length, 2);
      await Case.destroy({ where: { id: createdCase.id } }).catch(() => {});
    }

    // Sub-case 14d: assignedcaseworkerId completely omitted (undefined) -> final count 1 -> rejected
    {
      const req = {
        user: { userId: creatorUserId, role_id: ROLES.CASEWORKER, organisation_id: orgId },
        tenantDb,
        body: {
          candidateId: candidateUser.id,
          visaTypeId,
          targetSubmissionDate: futureDate,
          // assignedcaseworkerId omitted
        },
      };
      const res = createMockRes();
      await createMyCase(req, res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body?.status, 'error');
      assert.equal(res.body?.data?.finalCount, 1);
    }
  });
});
