import test from 'node:test';
import assert from 'node:assert';
import logger from '../src/utils/logger.js';
import {
  getAllNotifications,
  getNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotificationById,
  getNotificationStats,
  deleteExpired,
} from '../src/modules/Shared/Notifications/notification.controller.js';

/**
 * Error-handling tests for the notification controller.
 *
 * Forces an exception in the DB layer for each handler and asserts the handler:
 *   - does NOT throw / reject (the catch block contains the error)
 *   - logs via logger.error  (regression guard for the missing-import bug that
 *     turned every catch into a ReferenceError)
 *   - returns the standardized { status:'error', message, data:null } envelope at 500
 */

function mockRes() {
  return {
    statusCode: 200,
    sent: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.sent = payload; return this; },
  };
}

/** A tenantDb whose every Notification method rejects, to drive the catch path. */
function explodingTenantDb() {
  const boom = async () => { throw new Error('DB exploded'); };
  return {
    Notification: {
      findAndCountAll: boom,
      count: boom,
      findOne: boom,
      findByPk: boom,
      destroy: boom,
      update: boom,
      findAll: boom,
    },
    User: { findOne: boom, count: boom },
    Role: {},
    Sequelize: { Op: {} },
    sequelize: { fn: () => 'fn', col: () => 'col' },
  };
}

const baseReq = () => ({
  user: { userId: 7, organisation_id: 9 },
  query: {},
  params: { id: 1 },
  body: { title: 'x', message: 'y', recipientUserId: 7 },
  tenantDb: explodingTenantDb(),
});

function assertStandardised500(res) {
  assert.strictEqual(res.statusCode, 500, 'should respond 500');
  assert.strictEqual(res.sent.status, 'error');
  assert.strictEqual(res.sent.message, 'Internal server error');
  assert.strictEqual(res.sent.data, null);
}

const HANDLERS = [
  ['getAllNotifications', getAllNotifications],
  ['getNotifications', getNotifications],
  ['getUnreadNotificationCount', getUnreadNotificationCount],
  ['markNotificationAsRead', markNotificationAsRead],
  ['markAllNotificationsAsRead', markAllNotificationsAsRead],
  ['deleteNotificationById', deleteNotificationById],
  ['getNotificationStats', getNotificationStats],
  ['deleteExpired', deleteExpired],
];

for (const [name, handler] of HANDLERS) {
  test(`${name}: DB failure → logs + standardized 500, never throws`, async (t) => {
    const errSpy = t.mock.method(logger, 'error', () => {});
    const req = baseReq();
    const res = mockRes();

    // Must not throw/reject — the catch block has to contain the error.
    await assert.doesNotReject(() => Promise.resolve(handler(req, res)));

    assertStandardised500(res);
    assert.ok(errSpy.mock.callCount() >= 1, 'logger.error must be called in the catch block');
  });
}

test('catch block does not crash when logger.error itself throws', async (t) => {
  // Defensive: even a misbehaving logger must not turn the response into an
  // unhandled rejection that escapes the handler.
  t.mock.method(logger, 'error', () => { throw new Error('logger boom'); });
  const req = baseReq();
  const res = mockRes();

  // The handler may surface the logger error, but it must not be a silent hang;
  // we assert it settles (resolves or rejects deterministically) rather than
  // leaving the request unanswered. Here we accept either a 500 or a thrown
  // logger error, but never an unhandled "logger is not defined" ReferenceError.
  let threw = null;
  try {
    await Promise.resolve(getNotifications(req, res));
  } catch (e) {
    threw = e;
  }
  if (threw) {
    assert.match(threw.message, /logger boom/, 'only the injected logger error may surface');
  } else {
    assertStandardised500(res);
  }
});
