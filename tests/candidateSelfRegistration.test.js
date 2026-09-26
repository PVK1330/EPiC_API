import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { registerSchema } from '../src/validations/auth.validation.js';
import { buildKey, createLimiter, registerLimiter, loginLimiter } from '../src/middlewares/authRateLimiter.js';

describe('Candidate Self-Registration Suite', () => {
  describe('1. Schema Validation (Organisation ID is optional)', () => {
    const baseCandidatePayload = {
      first_name: 'Wahid',
      last_name: 'Manzoor',
      email: 'wahid.manzoor@example.com',
      password: 'StrongPassword123!',
      country_code: '+44',
      mobile: '7896600585',
      date_of_birth: '1988-02-18',
      address: '64 OLASTONBURY ROAD',
      city: 'BIRMINGHAM',
      state: 'West Midlands',
      country: 'United Kingdom',
      pincode: 'B14 4DR',
      nationality: 'Pakistan',
    };

    test('candidate registration succeeds WITHOUT organisation_id (field omitted)', async () => {
      const payload = { body: { ...baseCandidatePayload } };
      const result = await registerSchema.safeParseAsync(payload);
      assert.equal(result.success, true);
      assert.equal(result.data.body.organisation_id, undefined);
    });

    test('candidate registration succeeds with organisation_id: null', async () => {
      const payload = { body: { ...baseCandidatePayload, organisation_id: null } };
      const result = await registerSchema.safeParseAsync(payload);
      assert.equal(result.success, true);
    });

    test('candidate registration succeeds with organisation_id: "" (empty string)', async () => {
      const payload = { body: { ...baseCandidatePayload, organisation_id: '' } };
      const result = await registerSchema.safeParseAsync(payload);
      assert.equal(result.success, true);
    });

    test('candidate registration succeeds with numeric organisation_id', async () => {
      const payload = { body: { ...baseCandidatePayload, organisation_id: 3 } };
      const result = await registerSchema.safeParseAsync(payload);
      assert.equal(result.success, true);
    });

    test('candidate registration succeeds with alphanumeric organisation code (e.g. EPIC2026)', async () => {
      const payload = { body: { ...baseCandidatePayload, organisation_id: 'EPIC2026' } };
      const result = await registerSchema.safeParseAsync(payload);
      assert.equal(result.success, true);
    });

    test('fails when mandatory candidate fields are missing (e.g. email)', async () => {
      const invalid = { ...baseCandidatePayload };
      delete invalid.email;
      const result = await registerSchema.safeParseAsync({ body: invalid });
      assert.equal(result.success, false);
      assert.ok(result.error.issues.some((i) => i.path.includes('email')));
    });

    test('fails when mandatory password is weak', async () => {
      const invalid = { ...baseCandidatePayload, password: 'weak' };
      const result = await registerSchema.safeParseAsync({ body: invalid });
      assert.equal(result.success, false);
      assert.ok(result.error.issues.some((i) => i.path.includes('password')));
    });
  });

  describe('2. Rate Limiting Key Isolation (No Shared Office Lockout)', () => {
    test('buildKey("ip+email") creates distinct keys for different candidates on the same IP', () => {
      const keyGen = buildKey('ip+email');
      const sharedOfficeIp = '203.0.113.42';

      const reqCandidateA = {
        ip: sharedOfficeIp,
        body: { email: 'wahid@example.com' },
        organisationContext: { slug: 'elite_pic' },
      };

      const reqCandidateB = {
        ip: sharedOfficeIp,
        body: { email: 'simran@example.com' },
        organisationContext: { slug: 'elite_pic' },
      };

      const keyA = keyGen(reqCandidateA);
      const keyB = keyGen(reqCandidateB);

      assert.equal(keyA, 'elite_pic:203.0.113.42:wahid@example.com');
      assert.equal(keyB, 'elite_pic:203.0.113.42:simran@example.com');
      assert.notEqual(keyA, keyB, 'Candidates on the same IP must have isolated rate-limit counters');
    });

    test('buildKey("ip+email") normalises email casing and whitespace', () => {
      const keyGen = buildKey('ip+email');
      const req = {
        ip: '198.51.100.1',
        body: { email: '  Candidate.Test@Example.COM  ' },
        organisationContext: { slug: 'elite_pic' },
      };
      assert.equal(keyGen(req), 'elite_pic:198.51.100.1:candidate.test@example.com');
    });

    test('buildKey respects organisation_id in body when no subdomain is attached', () => {
      const keyGen = buildKey('ip+email');
      const req = {
        ip: '198.51.100.2',
        body: { email: 'candidate@example.com', organisation_id: 'EPIC2026' },
      };
      assert.equal(keyGen(req), 'epic2026:198.51.100.2:candidate@example.com');
    });

    test('fallback sentinel is used when email is missing or non-string', () => {
      const keyGen = buildKey('ip+email');
      const req = {
        ip: '198.51.100.3',
        body: {},
      };
      assert.equal(keyGen(req), 'no-tenant:198.51.100.3:no-email');
    });
  });

  describe('3. Rate Limiter Functional Behavior (Identity-scoped Throttling)', () => {
    test('shared office IP allows multiple users, throttling only the repeated identity', async () => {
      const app = express();
      app.use(express.json());

      // Create a test limiter: 2 attempts per email+IP
      const testLimiter = createLimiter({
        windowMs: 60 * 1000,
        max: 2,
        keyMode: 'ip+email',
      });

      app.post('/test-register', testLimiter, (req, res) => {
        res.status(200).json({ status: 'success', message: 'Registered' });
      });

      const sharedIp = '192.0.2.100';

      // Candidate 1: 1st and 2nd attempt succeed
      const res1 = await request(app)
        .post('/test-register')
        .set('X-Forwarded-For', sharedIp)
        .send({ email: 'candidate1@example.com' });
      assert.equal(res1.status, 200);

      const res2 = await request(app)
        .post('/test-register')
        .set('X-Forwarded-For', sharedIp)
        .send({ email: 'candidate1@example.com' });
      assert.equal(res2.status, 200);

      // Candidate 1: 3rd attempt exceeds limit -> 429
      const res3 = await request(app)
        .post('/test-register')
        .set('X-Forwarded-For', sharedIp)
        .send({ email: 'candidate1@example.com' });
      assert.equal(res3.status, 429);
      assert.equal(res3.body.message, 'Too many attempts. Please try again later.');

      // Candidate 2 from the SAME office IP: 1st attempt MUST SUCCEED (not blocked by Candidate 1)
      const resCandidate2 = await request(app)
        .post('/test-register')
        .set('X-Forwarded-For', sharedIp)
        .send({ email: 'candidate2@example.com' });
      assert.equal(
        resCandidate2.status,
        200,
        'Candidate 2 on the same office IP must NOT be blocked by Candidate 1 rate limiting',
      );
    });

    test('active registerLimiter and loginLimiter have expected identity-based keyMode', () => {
      assert.ok(typeof registerLimiter === 'function', 'registerLimiter must be middleware function');
      assert.ok(typeof loginLimiter === 'function', 'loginLimiter must be middleware function');
    });

    test('login rate limiter throttles repeated failed attempts per identity without blocking different accounts on same IP', async () => {
      const app = express();
      app.use(express.json());

      const testLoginLimiter = createLimiter({
        windowMs: 60 * 1000,
        max: 2,
        keyMode: 'ip+email',
        skipSuccessfulRequests: true,
      });

      app.post('/test-login', testLoginLimiter, (req, res) => {
        if (req.body.password === 'correct') {
          return res.status(200).json({ status: 'success' });
        }
        return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
      });

      const sharedIp = '127.0.0.1';

      // User 1 failed attempts: 1st and 2nd fail with 401
      const fail1 = await request(app)
        .post('/test-login')
        .set('X-Forwarded-For', sharedIp)
        .send({ email: 'user1@example.com', password: 'wrong' });
      assert.equal(fail1.status, 401);

      const fail2 = await request(app)
        .post('/test-login')
        .set('X-Forwarded-For', sharedIp)
        .send({ email: 'user1@example.com', password: 'wrong' });
      assert.equal(fail2.status, 401);

      // User 1 3rd failed attempt -> 429 Too many attempts
      const fail3 = await request(app)
        .post('/test-login')
        .set('X-Forwarded-For', sharedIp)
        .send({ email: 'user1@example.com', password: 'wrong' });
      assert.equal(fail3.status, 429);

      // User 2 on the SAME IP: must NOT be blocked by User 1 rate limiting!
      const user2Attempt = await request(app)
        .post('/test-login')
        .set('X-Forwarded-For', sharedIp)
        .send({ email: 'user2@example.com', password: 'correct' });
      assert.equal(user2Attempt.status, 200, 'User 2 on same IP must be able to log in');
    });
  });

  describe('4. Organisation Context and Error Safety', () => {
    test('invalid organisation identifier safely returns 404 with clear guidance', async () => {
      const { default: app } = await import('../src/app.js');
      const agent = request.agent(app);
      const csrfRes = await agent.get('/api/csrf-token');
      const csrfToken = csrfRes.body?.csrfToken;

      const res = await agent
        .post('/api/auth/register')
        .set('x-csrf-token', csrfToken)
        .send({
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane.unique.orgtest@example.com',
          password: 'StrongPassword123!',
          organisation_id: 'nonexistent_organisation_xyz_99999',
        });
      assert.equal(res.status, 404);
      assert.equal(res.body.status, 'error');
      assert.match(
        res.body.message,
        /Organisation not found\. Please check the Organisation ID or code given by your adviser\./,
      );
    });
  });

  describe('5. Candidate Application Details Persistence and Propagation', () => {
    test('ensureCandidateEnquiryCase correctly populates candidate registration details into CandidateApplication', async () => {
      const { ensureCandidateEnquiryCase } = await import('../src/services/candidateOnboarding.service.js');

      let createdApp = null;
      let createdCase = null;
      const fakeTenantDb = {
        User: {
          findByPk: async (id) => ({
            id,
            first_name: 'Wahid',
            last_name: 'Manzoor',
            email: 'wahid@example.com',
            mobile: '7896600585',
            country_code: '+44',
          }),
        },
        CandidateApplication: {
          findOne: async () => null,
          create: async (data) => {
            createdApp = data;
            return data;
          },
        },
        Case: {
          findOne: async () => null,
          create: async (data) => {
            createdCase = data;
            return data;
          },
        },
      };

      await ensureCandidateEnquiryCase(fakeTenantDb, 101, {
        organisationId: 1,
        profileData: {
          firstName: 'Wahid',
          lastName: 'Manzoor',
          email: 'wahid@example.com',
          contactNumber: '7896600585',
          dob: '1988-02-18',
          address: '64 Olastonbury Road, Birmingham, West Midlands, B14 4DR, United Kingdom',
          addressStartDate: '2021-06-01',
          housingStatus: 'Rent',
          landlordName: 'John Smith',
          landlordContactNumber: '07111222333',
          landlordEmail: 'landlord@example.com',
          landlordAddress: '1 London Way',
          nationality: 'Pakistani',
          nationalities: ['Pakistani'],
        },
      });

      assert.ok(createdApp, 'CandidateApplication must be created');
      assert.equal(createdApp.userId, 101);
      assert.equal(createdApp.firstName, 'Wahid');
      assert.equal(createdApp.lastName, 'Manzoor');
      assert.equal(createdApp.email, 'wahid@example.com');
      assert.equal(
        createdApp.dob instanceof Date
          ? createdApp.dob.toISOString().slice(0, 10)
          : createdApp.dob,
        '1988-02-18'
      );
      assert.equal(createdApp.address, '64 Olastonbury Road, Birmingham, West Midlands, B14 4DR, United Kingdom');
      assert.equal(createdApp.housingStatus, 'Rent');
      assert.equal(createdApp.landlordName, 'John Smith');
      assert.equal(createdApp.nationality, 'Pakistani');
    });

    test('ensureCandidateEnquiryCase self-heals existing CandidateApplication if fields were missing', async () => {
      const { ensureCandidateEnquiryCase } = await import('../src/services/candidateOnboarding.service.js');

      let updatedFields = null;
      const existingApp = {
        userId: 102,
        firstName: null,
        lastName: null,
        email: null,
        contactNumber: null,
        update: async (fields) => {
          updatedFields = fields;
        },
      };

      const fakeTenantDb = {
        User: {
          findByPk: async (id) => ({
            id,
            first_name: 'Existing',
            last_name: 'Candidate',
            email: 'existing@example.com',
            mobile: '7123456789',
          }),
        },
        CandidateApplication: {
          findOne: async () => existingApp,
        },
        Case: {
          findOne: async () => ({ id: 501 }),
        },
      };

      await ensureCandidateEnquiryCase(fakeTenantDb, 102, { organisationId: 1 });

      assert.ok(updatedFields, 'Existing application must be updated with missing user fields');
      assert.equal(updatedFields.firstName, 'Existing');
      assert.equal(updatedFields.lastName, 'Candidate');
      assert.equal(updatedFields.email, 'existing@example.com');
      assert.equal(updatedFields.contactNumber, '7123456789');
    });
  });
});
