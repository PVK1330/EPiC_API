import test from 'node:test';
import assert from 'node:assert';
import { sanitizeApplicationPayload } from '../src/utils/applicationPayload.util.js';

test('Application type validation: rejects arbitrary strings at payload util level', () => {
  assert.throws(
    () => {
      sanitizeApplicationPayload({
        applicationType: 'Skilled Worker Visa',
      });
    },
    (err) => {
      assert.strictEqual(err.message, 'Application type must be one of: Single, Family.');
      return true;
    }
  );
});

test('Application type validation: accepts Single and Family case-insensitively', () => {
  const single = sanitizeApplicationPayload({ applicationType: 'Single' });
  assert.strictEqual(single.applicationType, 'Single');

  const family = sanitizeApplicationPayload({ applicationType: 'family' });
  assert.strictEqual(family.applicationType, 'Family');
});

test('Defensive candidate service normalization logic: recovers when visa type is supplied as applicationType', () => {
  const rawApp = {
    applicationType: 'Skilled Worker Visa',
    nationality: 'British',
  };

  if (
    rawApp.applicationType &&
    !['single', 'family'].includes(String(rawApp.applicationType).trim().toLowerCase())
  ) {
    if (!rawApp.visaType) {
      rawApp.visaType = rawApp.applicationType;
    }
    rawApp.applicationType = 'Single';
  }

  const sanitized = sanitizeApplicationPayload(rawApp);
  assert.strictEqual(sanitized.applicationType, 'Single');
  assert.strictEqual(sanitized.visaType, 'Skilled Worker Visa');
  assert.strictEqual(sanitized.nationality, 'British');
});
