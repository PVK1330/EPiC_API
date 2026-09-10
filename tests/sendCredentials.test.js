import test from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { checkRole, ROLES, ADMIN_ROLES } from '../src/middlewares/role.middleware.js';
import { sendCredentialsToClientSchema, createCandidateSchema } from '../src/validations/candidate.validation.js';
import { CandidateService } from '../src/modules/Admin/Candidates/candidate.service.js';
import * as candidateMailService from '../src/services/candidateMail.service.js';
import * as auditService from '../src/services/audit.service.js';
import * as userSyncService from '../src/services/userSync.service.js';

function createMockResponse() {
  return {
    statusCode: 200,
    sent: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.sent = payload;
      return this;
    },
  };
}

function createReq({ user, body = {}, method = 'POST', path = '/api/admin/candidates/send-credentials' }) {
  return {
    user,
    body,
    method,
    originalUrl: path,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    tenantDb: {
      AuditLog: {
        create: async () => ({}),
      },
    },
  };
}

async function runMiddleware(middleware, req, res) {
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  return nextCalled;
}

// ── 1. Role Authorization Tests ──────────────────────────────────────────────
test('checkRole(ADMIN_ROLES): ADMIN is allowed (200/next)', async () => {
  const req = createReq({ user: { id: 1, role_id: ROLES.ADMIN, organisation_id: 10 } });
  const res = createMockResponse();
  const allowed = await runMiddleware(checkRole(ADMIN_ROLES), req, res);
  assert.strictEqual(allowed, true);
  assert.strictEqual(res.statusCode, 200);
});

test('checkRole(ADMIN_ROLES): SUPERADMIN is allowed (200/next)', async () => {
  const req = createReq({ user: { id: 2, role_id: ROLES.SUPERADMIN, organisation_id: 10 } });
  const res = createMockResponse();
  const allowed = await runMiddleware(checkRole(ADMIN_ROLES), req, res);
  assert.strictEqual(allowed, true);
  assert.strictEqual(res.statusCode, 200);
});

test('checkRole(ADMIN_ROLES): CASEWORKER is strictly FORBIDDEN (403)', async () => {
  const req = createReq({ user: { id: 3, role_id: ROLES.CASEWORKER, organisation_id: 10 } });
  const res = createMockResponse();
  const allowed = await runMiddleware(checkRole(ADMIN_ROLES), req, res);
  assert.strictEqual(allowed, false);
  assert.strictEqual(res.statusCode, 403);
});

test('checkRole(ADMIN_ROLES): CANDIDATE / CLIENT is strictly FORBIDDEN (403)', async () => {
  const req = createReq({ user: { id: 4, role_id: ROLES.CANDIDATE, organisation_id: 10 } });
  const res = createMockResponse();
  const allowed = await runMiddleware(checkRole(ADMIN_ROLES), req, res);
  assert.strictEqual(allowed, false);
  assert.strictEqual(res.statusCode, 403);
});

test('checkRole(ADMIN_ROLES): SPONSOR / BUSINESS is strictly FORBIDDEN (403)', async () => {
  const req = createReq({ user: { id: 5, role_id: ROLES.SPONSOR, organisation_id: 10 } });
  const res = createMockResponse();
  const allowed = await runMiddleware(checkRole(ADMIN_ROLES), req, res);
  assert.strictEqual(allowed, false);
  assert.strictEqual(res.statusCode, 403);
});

test('checkRole(ADMIN_ROLES): Unauthenticated request is rejected (401)', async () => {
  const req = createReq({ user: null });
  const res = createMockResponse();
  const allowed = await runMiddleware(checkRole(ADMIN_ROLES), req, res);
  assert.strictEqual(allowed, false);
  assert.strictEqual(res.statusCode, 401);
});

// ── 2. Validation Schema Tests ───────────────────────────────────────────────
test('sendCredentialsToClientSchema: accepts valid payload with 4 fields', () => {
  const valid = {
    body: {
      name: 'John Doe',
      email: 'john.doe@example.com',
      contact_number: '+44 7123 456789',
      visa_type: 'Skilled Worker',
    },
  };
  const parsed = sendCredentialsToClientSchema.safeParse(valid);
  assert.strictEqual(parsed.success, true);
  assert.strictEqual(parsed.data.body.name, 'John Doe');
  assert.strictEqual(parsed.data.body.email, 'john.doe@example.com');
  assert.strictEqual(parsed.data.body.contact_number, '+44 7123 456789');
  assert.strictEqual(parsed.data.body.visa_type, 'Skilled Worker');
});

test('sendCredentialsToClientSchema: rejects empty name', () => {
  const invalid = {
    body: {
      name: '',
      email: 'john.doe@example.com',
      contact_number: '+44 7123 456789',
      visa_type: 'Skilled Worker',
    },
  };
  const parsed = sendCredentialsToClientSchema.safeParse(invalid);
  assert.strictEqual(parsed.success, false);
  assert.ok(parsed.error.issues.some((i) => i.path.includes('name')));
});

test('sendCredentialsToClientSchema: rejects invalid email', () => {
  const invalid = {
    body: {
      name: 'John Doe',
      email: 'not-an-email',
      contact_number: '+44 7123 456789',
      visa_type: 'Skilled Worker',
    },
  };
  const parsed = sendCredentialsToClientSchema.safeParse(invalid);
  assert.strictEqual(parsed.success, false);
  assert.ok(parsed.error.issues.some((i) => i.path.includes('email')));
});

test('sendCredentialsToClientSchema: rejects short contact number (< 5 chars)', () => {
  const invalid = {
    body: {
      name: 'John Doe',
      email: 'john.doe@example.com',
      contact_number: '123',
      visa_type: 'Skilled Worker',
    },
  };
  const parsed = sendCredentialsToClientSchema.safeParse(invalid);
  assert.strictEqual(parsed.success, false);
  assert.ok(parsed.error.issues.some((i) => i.path.includes('contact_number')));
});

test('sendCredentialsToClientSchema: rejects missing visa_type', () => {
  const invalid = {
    body: {
      name: 'John Doe',
      email: 'john.doe@example.com',
      contact_number: '+44 7123 456789',
      visa_type: '',
    },
  };
  const parsed = sendCredentialsToClientSchema.safeParse(invalid);
  assert.strictEqual(parsed.success, false);
  assert.ok(parsed.error.issues.some((i) => i.path.includes('visa_type')));
});

import platformDb from '../src/models/index.js';

// ── 3. Service Workflow Tests ────────────────────────────────────────────────
function makeMockServiceDb({ existingEmailUser = null, existingMobileUser = null, visaTypeId = 5 } = {}) {
  let createdTenantUser = null;
  let createdApp = null;
  let createdCase = null;

  const tenantDb = {
    User: {
      findByPk: async () => null,
      findOne: async ({ where }) => {
        if (where?.email && existingEmailUser) return existingEmailUser;
        if (where?.mobile && existingMobileUser) return existingMobileUser;
        return null;
      },
      create: async (data) => {
        createdTenantUser = { ...data };
        return createdTenantUser;
      },
    },
    CandidateApplication: {
      create: async (data) => {
        createdApp = { ...data, id: 101 };
        return createdApp;
      },
    },
    Case: {
      create: async (data) => {
        createdCase = { ...data, id: 201 };
        return createdCase;
      },
    },
    VisaType: {
      findOne: async () => ({ id: visaTypeId, name: 'Skilled Worker' }),
    },
    AuditLog: {
      create: async () => ({}),
    },
    sequelize: {
      transaction: async (cb) => {
        return await cb({ id: 'mock-tx' });
      },
    },
  };

  return {
    tenantDb,
    getCreatedTenantUser: () => createdTenantUser,
    getCreatedApp: () => createdApp,
    getCreatedCase: () => createdCase,
  };
}

test('sendCredentialsToClient: successfully creates candidate, draft app, enquiry case, and dispatches email', async (t) => {
  const mockDb = makeMockServiceDb();
  const service = new CandidateService(mockDb.tenantDb);

  let userCreatedPayload = null;
  t.mock.method(platformDb.User, 'create', async (payload) => {
    userCreatedPayload = {
      ...payload,
      id: 77,
      get: () => ({ ...payload, id: 77 }),
      destroy: async () => {},
    };
    return userCreatedPayload;
  });
  t.mock.method(platformDb.User, 'findOne', async () => null);

  let emailSentPayload = null;
  const sendEmailFn = async (payload) => {
    emailSentPayload = payload;
    return { ok: true, loginUrl: 'https://cms.elitepic.co.uk/login' };
  };

  const adminUser = { id: 10, userId: 10, role_id: ROLES.ADMIN, organisation_id: 42 };
  const input = {
    name: 'Alice Wonder',
    email: 'Alice.Wonder@Example.com',
    contact_number: '+44 7911 123456',
    visa_type: 'Skilled Worker',
  };

  const result = await service.sendCredentialsToClient(input, { sendEmailFn }, adminUser);

  // 1. Check return structure (does NOT return password)
  assert.strictEqual(result.candidateId, 77);
  assert.strictEqual(result.emailSent, true);
  assert.strictEqual(result.temporary_password, undefined);

  // 2. Check User creation payload
  assert.ok(userCreatedPayload);
  assert.strictEqual(userCreatedPayload.first_name, 'Alice');
  assert.strictEqual(userCreatedPayload.last_name, 'Wonder');
  assert.strictEqual(userCreatedPayload.email, 'alice.wonder@example.com');
  assert.strictEqual(userCreatedPayload.role_id, ROLES.CANDIDATE);
  assert.strictEqual(userCreatedPayload.status, 'active');
  assert.strictEqual(userCreatedPayload.is_email_verified, true);
  assert.strictEqual(userCreatedPayload.organisation_id, 42);
  // Password must be a bcrypt hash (starts with $2a$ or $2b$)
  assert.ok(userCreatedPayload.password.startsWith('$2'));

  // 3. Check CandidateApplication payload
  const createdApp = mockDb.getCreatedApp();
  assert.ok(createdApp);
  assert.strictEqual(createdApp.userId, 77);
  assert.strictEqual(createdApp.firstName, 'Alice');
  assert.strictEqual(createdApp.lastName, 'Wonder');
  assert.strictEqual(createdApp.email, 'alice.wonder@example.com');
  assert.strictEqual(createdApp.contactNumber, '+44 7911123456');
  assert.strictEqual(createdApp.visaType, 'Skilled Worker');
  assert.strictEqual(createdApp.status, 'draft');
  assert.strictEqual(createdApp.isLocked, false);
  assert.strictEqual(createdApp.organisation_id, 42);

  // 4. Check Case payload
  const createdCase = mockDb.getCreatedCase();
  assert.ok(createdCase);
  assert.strictEqual(createdCase.candidateId, 77);
  assert.strictEqual(createdCase.visaTypeId, 5);
  assert.strictEqual(createdCase.status, 'Lead');
  assert.strictEqual(createdCase.organisation_id, 42);

  // 5. Check Email delivery payload
  assert.ok(emailSentPayload);
  assert.strictEqual(emailSentPayload.clientName, 'Alice Wonder');
  assert.strictEqual(emailSentPayload.organisationId, 42);
  assert.ok(emailSentPayload.plainPassword);
  assert.ok(emailSentPayload.plainPassword.length >= 12);

  // 6. Verify plain password matches hashed password in DB
  const passMatch = await bcrypt.compare(emailSentPayload.plainPassword, userCreatedPayload.password);
  assert.strictEqual(passMatch, true, 'Plaintext temporary password in email must match hashed password in DB');
});

test('sendCredentialsToClient: handles single word name without error', async (t) => {
  const mockDb = makeMockServiceDb();
  const service = new CandidateService(mockDb.tenantDb);

  let userCreatedPayload = null;
  t.mock.method(platformDb.User, 'create', async (payload) => {
    userCreatedPayload = {
      ...payload,
      id: 88,
      get: () => ({ ...payload, id: 88 }),
      destroy: async () => {},
    };
    return userCreatedPayload;
  });
  t.mock.method(platformDb.User, 'findOne', async () => null);

  const adminUser = { id: 10, role_id: ROLES.ADMIN, organisation_id: 42 };
  await service.sendCredentialsToClient({
    name: 'Cher',
    email: 'cher@example.com',
    contact_number: '+44 7111 222333',
    visa_type: 'Visitor Visa',
  }, { sendEmailFn: async () => ({ ok: true }) }, adminUser);

  assert.strictEqual(userCreatedPayload.first_name, 'Cher');
  assert.strictEqual(userCreatedPayload.last_name, '-');
  const app = mockDb.getCreatedApp();
  assert.strictEqual(app.firstName, 'Cher');
});

test('sendCredentialsToClient: correctly stores country_code and mobile separately for user and combined for application', async (t) => {
  const mockDb = makeMockServiceDb();
  let userCreatedPayload = null;
  t.mock.method(platformDb.User, 'create', async (payload) => {
    userCreatedPayload = payload;
    return {
      ...payload,
      id: 88,
      get: () => ({ ...payload, id: 88 }),
      destroy: async () => {},
    };
  });
  t.mock.method(platformDb.User, 'findOne', async () => null);

  const service = new CandidateService(mockDb.tenantDb);
  const adminUser = { id: 10, role_id: ROLES.ADMIN, organisation_id: 42 };

  await service.sendCredentialsToClient({
    name: 'Carlos Santana',
    email: 'carlos@example.com',
    country_code: '+1',
    contact_number: '2025550143',
    visa_type: 'Visitor Visa',
  }, { sendEmailFn: async () => ({ ok: true }) }, adminUser);

  // User model stores country_code and mobile separately
  assert.strictEqual(userCreatedPayload.country_code, '+1');
  assert.strictEqual(userCreatedPayload.mobile, '2025550143');

  // CandidateApplication stores full contact number with country code
  const app = mockDb.getCreatedApp();
  assert.strictEqual(app.contactNumber, '+1 2025550143');
});

test('sendCredentialsToClient: rejects duplicate email in same organisation', async (t) => {
  const mockDb = makeMockServiceDb({ existingEmailUser: { id: 99, email: 'duplicate@example.com' } });
  const service = new CandidateService(mockDb.tenantDb);

  const adminUser = { id: 10, role_id: ROLES.ADMIN, organisation_id: 42 };
  await assert.rejects(
    async () => {
      await service.sendCredentialsToClient({
        name: 'Bob Duplicate',
        email: 'duplicate@example.com',
        contact_number: '+44 7999 888777',
        visa_type: 'Student Visa',
      }, {}, adminUser);
    },
    (err) => {
      assert.strictEqual(err.status, 400);
      assert.strictEqual(err.message, 'This email address is already registered.');
      return true;
    }
  );
});

test('sendCredentialsToClient: handles SMTP delivery failure gracefully without rolling back account', async (t) => {
  const mockDb = makeMockServiceDb();
  const service = new CandidateService(mockDb.tenantDb);

  t.mock.method(platformDb.User, 'create', async (payload) => {
    return {
      ...payload,
      id: 90,
      get: () => ({ ...payload, id: 90 }),
      destroy: async () => {},
    };
  });
  t.mock.method(platformDb.User, 'findOne', async () => null);

  // Emulate SMTP delivery failure
  const sendEmailFn = async () => {
    return { ok: false, error: 'Connection timeout' };
  };

  const adminUser = { id: 10, role_id: ROLES.ADMIN, organisation_id: 42 };
  const result = await service.sendCredentialsToClient({
    name: 'Mail Fail',
    email: 'fail@example.com',
    contact_number: '+44 7555 444333',
    visa_type: 'Skilled Worker',
  }, { sendEmailFn }, adminUser);

  // Account creation succeeded, but emailSent is false
  assert.strictEqual(result.candidateId, 90);
  assert.strictEqual(result.emailSent, false);
});


// ── 4. Regression: Existing Add Client Schema Unchanged ──────────────────────
test('regression: createCandidateSchema still accepts full application wizard payload', () => {
  const fullPayload = {
    body: {
      first_name: 'Regular',
      last_name: 'Client',
      email: 'regular@example.com',
      country_code: '+44',
      mobile: '7123456789',
      application: {
        applicationType: 'Single',
        gender: 'Male',
        relationshipStatus: 'Single',
        address: '10 Downing St',
        addressStartDate: '2022-01-01',
        housingStatus: 'Own',
        nationality: 'British',
        dob: '1990-01-01',
        passportNumber: 'GB123456',
        issuingAuthority: 'HMPO',
        issueDate: '2020-01-01',
        expiryDate: '2030-01-01',
        visaType: 'Skilled Worker',
      },
    },
  };
  const parsed = createCandidateSchema.safeParse(fullPayload);
  assert.strictEqual(parsed.success, true);
  assert.strictEqual(parsed.data.body.first_name, 'Regular');
  assert.ok(parsed.data.body.application);
});
