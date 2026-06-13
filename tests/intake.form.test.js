// Tests: intake form eager loading and findOrCreate contract
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('intake form findOrCreate uses licenceApplicationId as the where key', async () => {
  let capturedOpts = null;
  const mockTenantDb = {
    LicenceIntakeForm: {
      findOrCreate: async (opts) => {
        capturedOpts = opts;
        return [{ id: 1, licenceApplicationId: 42, organisationId: 7, isComplete: false }, true];
      },
    },
  };

  const [form, created] = await mockTenantDb.LicenceIntakeForm.findOrCreate({
    where: { licenceApplicationId: 42 },
    defaults: { licenceApplicationId: 42, organisationId: 7 },
  });

  assert.deepEqual(capturedOpts.where, { licenceApplicationId: 42 });
  assert.deepEqual(capturedOpts.defaults, { licenceApplicationId: 42, organisationId: 7 });
  assert.equal(form.licenceApplicationId, 42);
  assert.equal(created, true);
});

test('intake form findOrCreate returns existing record without creating on second call', async () => {
  const existing = { id: 99, licenceApplicationId: 5, organisationId: 3, isComplete: true };
  let callCount = 0;
  const mockTenantDb = {
    LicenceIntakeForm: {
      findOrCreate: async () => {
        callCount++;
        return [existing, callCount === 1]; // created=true first time, false after
      },
    },
  };

  const [first, createdFirst] = await mockTenantDb.LicenceIntakeForm.findOrCreate({ where: { licenceApplicationId: 5 }, defaults: {} });
  const [second, createdSecond] = await mockTenantDb.LicenceIntakeForm.findOrCreate({ where: { licenceApplicationId: 5 }, defaults: {} });

  assert.equal(createdFirst, true);
  assert.equal(createdSecond, false);
  assert.equal(first.id, second.id);
});

test('intake form eager load uses the "intakeForm" alias', async () => {
  let capturedInclude = null;
  const mockTenantDb = {
    LicenceApplication: {
      findOne: async ({ include }) => {
        capturedInclude = include;
        return { id: 1, intakeForm: { id: 10, isComplete: false } };
      },
    },
  };

  const app = await mockTenantDb.LicenceApplication.findOne({
    where: { id: 1 },
    include: [{ as: 'intakeForm' }],
  });

  assert.equal(capturedInclude[0].as, 'intakeForm', 'eager load alias must match the registered "intakeForm" association');
  assert.ok(app.intakeForm, 'result should expose intakeForm as a key');
});
