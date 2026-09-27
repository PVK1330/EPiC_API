/**
 * tests/bug027_caseNoteAccess.test.js
 *
 * BUG-027: CASE NOTE ACCESS POLICY VERIFICATION
 *
 * Confirmed Business Rule:
 * Only Admin and assigned Caseworkers may add a Case Note.
 * Everyone else must be denied with HTTP 403:
 * - Admin -> ALLOWED
 * - Assigned Caseworker #1 -> ALLOWED
 * - Assigned Caseworker #2 -> ALLOWED
 * - Unassigned Caseworker -> DENIED (HTTP 403)
 * - Candidate / Client -> DENIED (HTTP 403)
 * - Sponsor -> DENIED (HTTP 403)
 *
 * Invariant: Exactly 2 caseworkers per case rule is preserved.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { createCaseNote } from '../src/modules/Admin/Dashboard/caseNote.controller.js';
import { ROLES, STAFF_ROLES } from '../src/middlewares/role.middleware.js';
import { singleCaseworkerError } from '../src/utils/case.utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to create mock response object
function createMockRes() {
  return {
    statusCode: null,
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

describe('BUG-027: Case Note Access Policy Verification', () => {
  // Case fixture with EXACTLY 2 assigned caseworkers: 101 and 102
  const mockCaseWithTwoCaseworkers = {
    id: 55,
    caseId: 'EPIC-ILR26-001',
    candidateId: 201,
    sponsorId: 301,
    assignedcaseworkerId: [101, 102], // Exactly 2 caseworkers
  };

  const createdNotes = [];

  const mockTenantDb = {
    Case: {
      findByPk: async (id) => {
        if (Number(id) === 55) return mockCaseWithTwoCaseworkers;
        return null;
      },
      findOne: async ({ where }) => {
        if (where?.caseId === 'EPIC-ILR26-001' || Number(where?.id) === 55) {
          return mockCaseWithTwoCaseworkers;
        }
        return null;
      },
    },
    CaseNote: {
      create: async (data) => {
        const note = {
          id: createdNotes.length + 1,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        createdNotes.push(note);
        return note;
      },
      findByPk: async () => null,
    },
  };

  // -------------------------------------------------------------------------
  // TEST 1: Admin creates Case Note -> HTTP 201
  // -------------------------------------------------------------------------
  test('TEST 1: Admin creates Case Note -> HTTP 201 (success)', async () => {
    const req = {
      body: {
        caseId: 55,
        content: 'Admin note regarding case compliance review.',
      },
      user: {
        userId: 1,
        role_id: ROLES.ADMIN, // Admin (3)
      },
      tenantDb: mockTenantDb,
    };
    const res = createMockRes();

    await createCaseNote(req, res);

    assert.equal(res.statusCode, 201, 'Admin should receive HTTP 201');
    assert.equal(res.body?.status, 'success');
    assert.ok(res.body?.data?.note, 'Note was created successfully');
    assert.equal(res.body.data.note.content, 'Admin note regarding case compliance review.');
    assert.equal(res.body.data.note.authorId, 1);
  });

  // -------------------------------------------------------------------------
  // TEST 2: Assigned Caseworker #1 creates Case Note -> HTTP 201
  // -------------------------------------------------------------------------
  test('TEST 2: Assigned Caseworker #1 (ID: 101) creates Case Note -> HTTP 201 (success)', async () => {
    const req = {
      body: {
        caseId: 55,
        content: 'Lead caseworker note: eligibility documentation checked.',
      },
      user: {
        userId: 101, // Assigned Caseworker #1
        role_id: ROLES.CASEWORKER, // Caseworker (2)
      },
      tenantDb: mockTenantDb,
    };
    const res = createMockRes();

    await createCaseNote(req, res);

    assert.equal(res.statusCode, 201, 'Assigned Caseworker #1 should receive HTTP 201');
    assert.equal(res.body?.status, 'success');
    assert.ok(res.body?.data?.note);
    assert.equal(res.body.data.note.authorId, 101);
  });

  // -------------------------------------------------------------------------
  // TEST 3: Assigned Caseworker #2 creates Case Note -> HTTP 201
  // -------------------------------------------------------------------------
  test('TEST 3: Assigned Caseworker #2 (ID: 102) creates Case Note -> HTTP 201 (success)', async () => {
    // Verifying invariant: exactly 2 assigned caseworkers on the case
    assert.equal(
      mockCaseWithTwoCaseworkers.assignedcaseworkerId.length,
      2,
      'Case must contain exactly 2 assigned caseworkers'
    );
    assert.ok(mockCaseWithTwoCaseworkers.assignedcaseworkerId.includes(102));

    const req = {
      body: {
        caseId: 55,
        content: 'Joint caseworker note: draft application verification complete.',
      },
      user: {
        userId: 102, // Assigned Caseworker #2
        role_id: ROLES.CASEWORKER, // Caseworker (2)
      },
      tenantDb: mockTenantDb,
    };
    const res = createMockRes();

    await createCaseNote(req, res);

    assert.equal(res.statusCode, 201, 'Assigned Caseworker #2 should receive HTTP 201');
    assert.equal(res.body?.status, 'success');
    assert.ok(res.body?.data?.note);
    assert.equal(res.body.data.note.authorId, 102);
  });

  // -------------------------------------------------------------------------
  // TEST 4: Unassigned Caseworker attempts to create Case Note -> HTTP 403
  // -------------------------------------------------------------------------
  test('TEST 4: Unassigned Caseworker (ID: 103) attempts to create Case Note -> HTTP 403 (denied)', async () => {
    const req = {
      body: {
        caseId: 55,
        content: 'Unassigned colleague attempting to leave note for colleague.',
      },
      user: {
        userId: 103, // Unassigned Caseworker
        role_id: ROLES.CASEWORKER, // Caseworker (2)
      },
      tenantDb: mockTenantDb,
    };
    const res = createMockRes();

    await createCaseNote(req, res);

    assert.equal(res.statusCode, 403, 'Unassigned caseworker must be denied with HTTP 403');
    assert.equal(res.body?.status, 'error');
    assert.equal(res.body?.message, 'You are not authorized to add notes to this case.');
  });

  // -------------------------------------------------------------------------
  // TEST 5: Candidate/Client attempts to create internal Case Note -> HTTP 403
  // -------------------------------------------------------------------------
  test('TEST 5: Candidate/Client (ID: 201) attempts to create internal Case Note -> HTTP 403 (denied)', async () => {
    const req = {
      body: {
        caseId: 55,
        content: 'Client trying to add internal note to own case.',
      },
      user: {
        userId: 201, // Candidate/Client
        role_id: ROLES.CANDIDATE, // Candidate (1)
      },
      tenantDb: mockTenantDb,
    };
    const res = createMockRes();

    await createCaseNote(req, res);

    assert.equal(res.statusCode, 403, 'Candidate/Client must be denied with HTTP 403');
    assert.equal(res.body?.status, 'error');
    assert.equal(res.body?.message, 'You are not authorized to add notes to this case.');
  });

  // -------------------------------------------------------------------------
  // TEST 6: Sponsor attempts to create internal Case Note -> HTTP 403
  // -------------------------------------------------------------------------
  test('TEST 6: Sponsor (ID: 301) attempts to create internal Case Note -> HTTP 403 (denied)', async () => {
    const req = {
      body: {
        caseId: 55,
        content: 'Sponsor trying to add internal note.',
      },
      user: {
        userId: 301, // Sponsor
        role_id: ROLES.SPONSOR, // Sponsor (4)
      },
      tenantDb: mockTenantDb,
    };
    const res = createMockRes();

    await createCaseNote(req, res);

    assert.equal(res.statusCode, 403, 'Sponsor must be denied with HTTP 403');
    assert.equal(res.body?.status, 'error');
    assert.equal(res.body?.message, 'You are not authorized to add notes to this case.');
  });

  // -------------------------------------------------------------------------
  // HTTP SERVER SETUP FOR DIRECT API REQUESTS (TESTS 7, 8, 9)
  // -------------------------------------------------------------------------
  let server;
  let baseUrl;

  before(async () => {
    const app = express();
    app.use(express.json());

    // Middleware simulating authentication & tenant resolution from header
    app.use((req, res, next) => {
      req.tenantDb = mockTenantDb;
      const roleHeader = req.headers['x-test-role-id'];
      const userHeader = req.headers['x-test-user-id'];

      if (userHeader) {
        req.user = {
          userId: Number(userHeader),
          id: Number(userHeader),
          role_id: Number(roleHeader),
          organisation_id: 1,
        };
      }
      next();
    });

    // Mount router guard + controller for /api/case-notes
    const router = express.Router();
    router.use((req, res, next) => {
      // Role middleware check matching router.use(checkRole(STAFF_ROLES))
      if (!req.user) {
        return res.status(401).json({ status: 'error', message: 'Authentication required' });
      }
      const roleId = Number(req.user.role_id);
      if (!STAFF_ROLES.includes(roleId)) {
        return res.status(403).json({ status: 'error', message: 'You do not have permission to access this resource' });
      }
      next();
    });
    router.post('/', createCaseNote);

    app.use('/api/case-notes', router);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // -------------------------------------------------------------------------
  // TEST 7: Unassigned Caseworker attempts direct API request -> HTTP 403
  // -------------------------------------------------------------------------
  test('TEST 7: Unassigned Caseworker direct API POST /api/case-notes -> HTTP 403', async () => {
    const res = await fetch(`${baseUrl}/api/case-notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user-id': '103', // Unassigned caseworker
        'x-test-role-id': String(ROLES.CASEWORKER),
      },
      body: JSON.stringify({
        caseId: 55,
        content: 'Direct API call from unassigned caseworker',
      }),
    });

    const body = await res.json();
    assert.equal(res.status, 403, 'Direct API call must return HTTP 403');
    assert.equal(body.status, 'error');
    assert.equal(body.message, 'You are not authorized to add notes to this case.');
  });

  // -------------------------------------------------------------------------
  // TEST 8: Assigned Caseworker direct API request -> HTTP 201 (success)
  // -------------------------------------------------------------------------
  test('TEST 8: Assigned Caseworker direct API POST /api/case-notes -> HTTP 201 (success)', async () => {
    const res = await fetch(`${baseUrl}/api/case-notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user-id': '101', // Assigned caseworker
        'x-test-role-id': String(ROLES.CASEWORKER),
      },
      body: JSON.stringify({
        caseId: 55,
        content: 'Direct API call from assigned caseworker',
      }),
    });

    const body = await res.json();
    assert.equal(res.status, 201, 'Direct API call from assigned caseworker must return HTTP 201');
    assert.equal(body.status, 'success');
    assert.ok(body.data?.note);
    assert.equal(body.data.note.authorId, 101);
  });

  // -------------------------------------------------------------------------
  // TEST 9: Admin direct API request -> HTTP 201 (success)
  // -------------------------------------------------------------------------
  test('TEST 9: Admin direct API POST /api/case-notes -> HTTP 201 (success)', async () => {
    const res = await fetch(`${baseUrl}/api/case-notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user-id': '1', // Admin
        'x-test-role-id': String(ROLES.ADMIN),
      },
      body: JSON.stringify({
        caseId: 55,
        content: 'Direct API call from Admin',
      }),
    });

    const body = await res.json();
    assert.equal(res.status, 201, 'Direct API call from Admin must return HTTP 201');
    assert.equal(body.status, 'success');
    assert.ok(body.data?.note);
    assert.equal(body.data.note.authorId, 1);
  });

  // -------------------------------------------------------------------------
  // TEST 10: Case with exactly 2 assigned caseworkers remains valid
  // -------------------------------------------------------------------------
  test('TEST 10: Case with exactly 2 assigned caseworkers remains valid and untouched', () => {
    // 1. Verify case fixture has exactly 2 assigned caseworkers
    assert.equal(mockCaseWithTwoCaseworkers.assignedcaseworkerId.length, 2);
    assert.deepEqual(mockCaseWithTwoCaseworkers.assignedcaseworkerId, [101, 102]);

    // 2. Verify controller source file preserves the access rule without modifying caseworker rules
    const controllerPath = path.resolve(__dirname, '../src/modules/Admin/Dashboard/caseNote.controller.js');
    const controllerSrc = fs.readFileSync(controllerPath, 'utf8');

    assert.ok(
      controllerSrc.includes('roleId === ROLES.CASEWORKER && assignedIds.includes(Number(userId))'),
      'Controller strictly checks that user is an assigned caseworker'
    );
    assert.ok(
      controllerSrc.includes('isAdmin = roleId === ROLES.ADMIN || roleId === ROLES.SUPERADMIN'),
      'Controller allows Admin / Superadmin'
    );
    assert.ok(
      controllerSrc.includes('You are not authorized to add notes to this case.'),
      'Controller denies unauthorized access with clear message'
    );

    // 3. Confirm singleCaseworkerError utility is preserved
    assert.equal(typeof singleCaseworkerError, 'function');
  });
});
