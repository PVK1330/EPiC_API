// Security tests: mass-assignment protection and raw error exposure (C-6/C-7/H-6/M-5/M-6)
//
// These tests verify the Zod schemas used by the validate() middleware:
//   sponsorSubmitLicenceSchema  — POST /api/business/licence/apply
//   sponsorUpdateLicenceSchema  — PUT  /api/business/licence/update/:id
//   adminUpdateLicenceSchema    — PUT  /api/admin/licence/update/:id
//
// Protected fields that must NEVER pass through:
//   status, assignedcaseworkerId, userId, organisationId, type,
//   applicationVersion, cosAllocation, adminNotes (sponsor only),
//   requestedDocuments (sponsor only), licenceNumber, licenceIssueDate,
//   licenceExpiryDate, documents
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  sponsorSubmitLicenceSchema,
  sponsorUpdateLicenceSchema,
  adminUpdateLicenceSchema,
} from '../src/validations/licenceApplication.validation.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function parseBody(schema, body, params = {}) {
  const result = await schema.parseAsync({ body, params });
  return result.body;
}

// ── sponsorSubmitLicenceSchema ─────────────────────────────────────────────────

describe('sponsorSubmitLicenceSchema — mass assignment protection', () => {
  test('strips status from submission body', async () => {
    const body = await parseBody(sponsorSubmitLicenceSchema, {
      companyName: 'ACME Ltd',
      status: 'Approved', // attack field
    });
    assert.equal(body.companyName, 'ACME Ltd');
    assert.equal(body.status, undefined, '"status" must not appear in parsed body');
  });

  test('strips assignedcaseworkerId from submission body', async () => {
    const body = await parseBody(sponsorSubmitLicenceSchema, {
      companyName: 'ACME Ltd',
      assignedcaseworkerId: [99, 100],
    });
    assert.equal(body.assignedcaseworkerId, undefined);
  });

  test('strips userId from submission body', async () => {
    const body = await parseBody(sponsorSubmitLicenceSchema, {
      companyName: 'ACME Ltd',
      userId: 9999,
    });
    assert.equal(body.userId, undefined);
  });

  test('strips cosAllocation from submission body', async () => {
    const body = await parseBody(sponsorSubmitLicenceSchema, {
      companyName: 'ACME Ltd',
      cosAllocation: 500,
    });
    assert.equal(body.cosAllocation, undefined);
  });

  test('strips licenceNumber from submission body', async () => {
    const body = await parseBody(sponsorSubmitLicenceSchema, {
      companyName: 'ACME Ltd',
      licenceNumber: 'PK12345678',
    });
    assert.equal(body.licenceNumber, undefined);
  });

  test('strips adminNotes from submission body', async () => {
    const body = await parseBody(sponsorSubmitLicenceSchema, {
      companyName: 'ACME Ltd',
      adminNotes: 'Injected admin note',
    });
    assert.equal(body.adminNotes, undefined);
  });

  test('strips requestedDocuments from submission body', async () => {
    const body = await parseBody(sponsorSubmitLicenceSchema, {
      companyName: 'ACME Ltd',
      requestedDocuments: ['forged doc'],
    });
    assert.equal(body.requestedDocuments, undefined);
  });

  test('allows legitimate sponsor fields through', async () => {
    const body = await parseBody(sponsorSubmitLicenceSchema, {
      companyName: 'ACME Ltd',
      tradingName: 'ACME Trading',
      registrationNumber: '12345678',
      industry: 'Technology',
      contactName: 'Jane Doe',
      contactEmail: 'jane@acme.com',
      contactPhone: '+447700000000',
      licenceType: 'Skilled Worker',
      reason: 'Need workers',
    });
    assert.equal(body.companyName, 'ACME Ltd');
    assert.equal(body.contactEmail, 'jane@acme.com');
    assert.equal(body.reason, 'Need workers');
  });

  test('normalises empty proposedStartDate to null', async () => {
    const body = await parseBody(sponsorSubmitLicenceSchema, {
      proposedStartDate: '',
    });
    assert.equal(body.proposedStartDate, null);
  });

  test('normalises "Invalid date" proposedStartDate to null', async () => {
    const body = await parseBody(sponsorSubmitLicenceSchema, {
      proposedStartDate: 'Invalid date',
    });
    assert.equal(body.proposedStartDate, null);
  });
});

// ── sponsorUpdateLicenceSchema ────────────────────────────────────────────────

describe('sponsorUpdateLicenceSchema — mass assignment protection', () => {
  const VALID_PARAMS = { id: '42' };

  test('strips status from update body', async () => {
    const body = await parseBody(sponsorUpdateLicenceSchema, {
      companyName: 'ACME Ltd',
      status: 'Approved',
    }, VALID_PARAMS);
    assert.equal(body.status, undefined);
  });

  test('strips assignedcaseworkerId from update body', async () => {
    const body = await parseBody(sponsorUpdateLicenceSchema, {
      assignedcaseworkerId: [1, 2, 3],
    }, VALID_PARAMS);
    assert.equal(body.assignedcaseworkerId, undefined);
  });

  test('strips organisationId from update body', async () => {
    const body = await parseBody(sponsorUpdateLicenceSchema, {
      organisationId: 7,
    }, VALID_PARAMS);
    assert.equal(body.organisationId, undefined);
  });

  test('strips applicationVersion from update body', async () => {
    const body = await parseBody(sponsorUpdateLicenceSchema, {
      applicationVersion: 'v2',
    }, VALID_PARAMS);
    assert.equal(body.applicationVersion, undefined);
  });

  test('strips type from update body', async () => {
    const body = await parseBody(sponsorUpdateLicenceSchema, {
      type: 'Renewal',
    }, VALID_PARAMS);
    assert.equal(body.type, undefined);
  });

  test('strips licenceIssueDate and licenceExpiryDate from update body', async () => {
    const body = await parseBody(sponsorUpdateLicenceSchema, {
      licenceIssueDate: '2020-01-01',
      licenceExpiryDate: '2025-01-01',
    }, VALID_PARAMS);
    assert.equal(body.licenceIssueDate, undefined);
    assert.equal(body.licenceExpiryDate, undefined);
  });

  test('strips documents from update body (file-upload endpoint only)', async () => {
    const body = await parseBody(sponsorUpdateLicenceSchema, {
      documents: ['storage/private/evil.php'],
    }, VALID_PARAMS);
    assert.equal(body.documents, undefined);
  });

  test('strips adminNotes from sponsor update body', async () => {
    const body = await parseBody(sponsorUpdateLicenceSchema, {
      adminNotes: 'Injected',
    }, VALID_PARAMS);
    assert.equal(body.adminNotes, undefined);
  });

  test('coerces valid application id from string to number in params', async () => {
    const result = await sponsorUpdateLicenceSchema.parseAsync({
      body: { companyName: 'ACME Ltd' },
      params: { id: '42' },
    });
    assert.equal(result.params.id, 42);
    assert.equal(typeof result.params.id, 'number');
  });

  test('rejects non-numeric application id', async () => {
    await assert.rejects(
      () => sponsorUpdateLicenceSchema.parseAsync({
        body: {},
        params: { id: 'not-a-number' },
      })
    );
  });

  test('allows legitimate sponsor update fields', async () => {
    const body = await parseBody(sponsorUpdateLicenceSchema, {
      companyName: 'Updated Ltd',
      contactEmail: 'updated@acme.com',
      estimatedAnnualCost: 50000,
    }, VALID_PARAMS);
    assert.equal(body.companyName, 'Updated Ltd');
    assert.equal(body.estimatedAnnualCost, 50000);
  });
});

// ── adminUpdateLicenceSchema ──────────────────────────────────────────────────

describe('adminUpdateLicenceSchema — admin-specific field rules', () => {
  const VALID_PARAMS = { id: '10' };

  test('allows adminNotes for admin updates', async () => {
    const body = await parseBody(adminUpdateLicenceSchema, {
      adminNotes: 'Internal reviewer note',
    }, VALID_PARAMS);
    assert.equal(body.adminNotes, 'Internal reviewer note');
  });

  test('allows requestedDocuments for admin updates', async () => {
    const body = await parseBody(adminUpdateLicenceSchema, {
      requestedDocuments: ['Company accounts', 'HR policy'],
    }, VALID_PARAMS);
    assert.deepEqual(body.requestedDocuments, ['Company accounts', 'HR policy']);
  });

  test('strips status from admin update body', async () => {
    const body = await parseBody(adminUpdateLicenceSchema, {
      companyName: 'ACME Ltd',
      status: 'Approved',  // use updateLicenceApplicationStatus instead
    }, VALID_PARAMS);
    assert.equal(body.status, undefined, 'status must go through updateLicenceApplicationStatus');
  });

  test('strips assignedcaseworkerId from admin update body', async () => {
    const body = await parseBody(adminUpdateLicenceSchema, {
      assignedcaseworkerId: [5],  // use assignCaseworker instead
    }, VALID_PARAMS);
    assert.equal(body.assignedcaseworkerId, undefined);
  });

  test('strips userId from admin update body', async () => {
    const body = await parseBody(adminUpdateLicenceSchema, {
      userId: 999,
    }, VALID_PARAMS);
    assert.equal(body.userId, undefined);
  });

  test('strips cosAllocation from admin update body', async () => {
    const body = await parseBody(adminUpdateLicenceSchema, {
      cosAllocation: 1000,
    }, VALID_PARAMS);
    assert.equal(body.cosAllocation, undefined);
  });

  test('strips licenceNumber from admin update body', async () => {
    const body = await parseBody(adminUpdateLicenceSchema, {
      licenceNumber: 'FORGED123',
    }, VALID_PARAMS);
    assert.equal(body.licenceNumber, undefined);
  });

  test('strips documents from admin update body', async () => {
    const body = await parseBody(adminUpdateLicenceSchema, {
      documents: ['path/to/evil'],
    }, VALID_PARAMS);
    assert.equal(body.documents, undefined);
  });

  test('rejects requestedDocuments exceeding 20 items', async () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `Document ${i + 1}`);
    await assert.rejects(
      () => adminUpdateLicenceSchema.parseAsync({
        body: { requestedDocuments: tooMany },
        params: { id: '1' },
      })
    );
  });

  test('allows all base sponsor fields alongside admin-only fields', async () => {
    const body = await parseBody(adminUpdateLicenceSchema, {
      companyName: 'ACME Ltd',
      adminNotes: 'Looks good',
      requestedDocuments: ['Bank statement'],
    }, VALID_PARAMS);
    assert.equal(body.companyName, 'ACME Ltd');
    assert.equal(body.adminNotes, 'Looks good');
  });
});

// ── M-6: error structure ──────────────────────────────────────────────────────

describe('M-6: validation error responses do not expose raw error objects', () => {
  test('invalid email triggers a structured validation error (no error.message leak)', async () => {
    let caught = null;
    try {
      await sponsorSubmitLicenceSchema.parseAsync({ body: { contactEmail: 'not-an-email' } });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'schema should throw on invalid email');
    // The error must be a ZodError with structured issues, not a raw Error with an
    // uncontrolled .message string that would reach the HTTP response body.
    assert.ok(Array.isArray(caught.issues), 'should be a ZodError with .issues array');
    assert.ok(caught.issues[0].path.length > 0, 'issue should identify the field');
    assert.ok(caught.issues[0].message, 'issue should have a human-readable message');
  });
});
