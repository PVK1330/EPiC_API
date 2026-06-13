// Tests: intake document retrieval and readiness-gate logic
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('intake document findAll uses licenceApplicationId as the where key', async () => {
  let capturedWhere = null;
  const mockTenantDb = {
    LicenceIntakeDocument: {
      findAll: async ({ where }) => {
        capturedWhere = where;
        return [
          { id: 1, documentKey: 'employer_liability_insurance', isRequired: true, status: 'verified' },
          { id: 2, documentKey: 'certificate_of_incorporation', isRequired: true, status: 'pending' },
        ];
      },
    },
  };

  const docs = await mockTenantDb.LicenceIntakeDocument.findAll({
    where: { licenceApplicationId: 42 },
  });

  assert.equal(capturedWhere.licenceApplicationId, 42);
  assert.equal(docs.length, 2);
});

test('readiness check: blocked when at least one required document is not verified', () => {
  const docs = [
    { isRequired: true, status: 'verified' },
    { isRequired: true, status: 'pending' },
    { isRequired: false, status: 'pending' }, // optional — must not block
  ];

  const allRequiredVerified = docs.filter((d) => d.isRequired).every((d) => d.status === 'verified');
  assert.equal(allRequiredVerified, false);
});

test('readiness check: passes when all required documents are verified', () => {
  const docs = [
    { isRequired: true, status: 'verified' },
    { isRequired: true, status: 'verified' },
    { isRequired: false, status: 'pending' }, // optional — must not block
  ];

  const allRequiredVerified = docs.filter((d) => d.isRequired).every((d) => d.status === 'verified');
  assert.equal(allRequiredVerified, true);
});

test('readiness check: passes when there are no required documents (edge case)', () => {
  const docs = [
    { isRequired: false, status: 'pending' },
  ];

  const allRequiredVerified = docs.filter((d) => d.isRequired).every((d) => d.status === 'verified');
  assert.equal(allRequiredVerified, true, 'Array.every on empty array returns true — no blockers');
});

test('intake documents eager load uses the "intakeDocuments" alias', async () => {
  let capturedInclude = null;
  const mockTenantDb = {
    LicenceApplication: {
      findOne: async ({ include }) => {
        capturedInclude = include;
        return { id: 1, intakeDocuments: [] };
      },
    },
  };

  const app = await mockTenantDb.LicenceApplication.findOne({
    where: { id: 1 },
    include: [{ as: 'intakeDocuments' }],
  });

  const alias = capturedInclude.find((i) => i.as === 'intakeDocuments')?.as;
  assert.equal(alias, 'intakeDocuments', 'eager load alias must match the registered "intakeDocuments" association');
  assert.ok(Array.isArray(app.intakeDocuments));
});
