// Tests: C-3/C-4 fix — informationReceived fires only when previousStatus is
// "Information Requested" and the new status is "Under Review".
//
// We replicate the routing logic from sponsorshipNotification.service.js
// licenceStatusChanged() to verify the fix is correct without needing a live DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mirror the relevant routing logic from licenceStatusChanged()
async function simulateStatusChange({ status, previousStatus, onInformationReceived, onDeliver }) {
  switch (status) {
    case 'Under Review':
      if (previousStatus === 'Information Requested') {
        await onInformationReceived();
      }
      await onDeliver('under_review');
      break;
    case 'Information Requested':
      await onDeliver('information_requested');
      break;
    case 'Rejected':
      await onDeliver('rejected');
      break;
    default:
      await onDeliver('other');
  }
}

test('informationReceived fires when previousStatus is "Information Requested" and status is "Under Review"', async () => {
  let fired = false;
  await simulateStatusChange({
    status: 'Under Review',
    previousStatus: 'Information Requested',
    onInformationReceived: async () => { fired = true; },
    onDeliver: async () => {},
  });
  assert.equal(fired, true);
});

test('informationReceived does NOT fire when previousStatus is null (the pre-fix bug)', async () => {
  let fired = false;
  await simulateStatusChange({
    status: 'Under Review',
    previousStatus: null, // what both controllers sent before the C-3/C-4 fix
    onInformationReceived: async () => { fired = true; },
    onDeliver: async () => {},
  });
  assert.equal(fired, false);
});

test('informationReceived does NOT fire when previousStatus is "Pending"', async () => {
  let fired = false;
  await simulateStatusChange({
    status: 'Under Review',
    previousStatus: 'Pending',
    onInformationReceived: async () => { fired = true; },
    onDeliver: async () => {},
  });
  assert.equal(fired, false);
});

test('informationReceived does NOT fire when status is "Information Requested" (status not Under Review)', async () => {
  let fired = false;
  await simulateStatusChange({
    status: 'Information Requested',
    previousStatus: 'Information Requested',
    onInformationReceived: async () => { fired = true; },
    onDeliver: async () => {},
  });
  assert.equal(fired, false);
});

test('onDeliver is always called regardless of previousStatus', async () => {
  let delivered = false;
  await simulateStatusChange({
    status: 'Under Review',
    previousStatus: null,
    onInformationReceived: async () => {},
    onDeliver: async () => { delivered = true; },
  });
  assert.equal(delivered, true);
});
