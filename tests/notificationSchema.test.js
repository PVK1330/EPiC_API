import test from 'node:test';
import assert from 'node:assert';
import { Sequelize, DataTypes } from 'sequelize';
import NotificationModelFactory from '../src/models/tenant/notification.model.js';
import {
  notifyUser,
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  setNotificationArchived,
} from '../src/services/notification.service.js';

/**
 * Schema-drift regression + behavior tests for notifications.
 *
 * Part A asserts the Sequelize model maps to the CANONICAL database columns
 * (the table from 006 + org-id + the new align migration). Constructing a
 * Sequelize instance does not open a connection, so we can inspect
 * rawAttributes offline.
 *
 * Part B exercises the service against an in-memory fake tenantDb and verifies
 * create / fetch / unread-count / mark-read / mark-all-read / archive, and that
 * the service keys everything on `userId` (not `recipientId`).
 */

// ─── Part A: model ↔ canonical column mapping ────────────────────────────────

const sequelize = new Sequelize('db', 'u', 'p', { dialect: 'postgres' }); // no connect
const Notification = NotificationModelFactory(sequelize, DataTypes);
const attrs = Notification.rawAttributes;

test('model maps recipient to canonical userId / roleId columns', () => {
  assert.strictEqual(attrs.userId.field, 'userId');
  assert.strictEqual(attrs.userId.allowNull, false);
  assert.strictEqual(attrs.roleId.field, 'roleId');
});

test('model uses canonical column names for every field', () => {
  const expected = {
    actionType: 'actionType',
    entityType: 'entityType',
    entityId: 'entityId',
    actionUrl: 'action_url',
    organisationId: 'organisation_id',
    isRead: 'is_read',
    readAt: 'read_at',
    isArchived: 'is_archived',
    sendEmail: 'send_email',
    emailSent: 'email_sent',
    category: 'category',
    type: 'type',
    priority: 'priority',
  };
  for (const [attr, col] of Object.entries(expected)) {
    assert.ok(attrs[attr], `attribute ${attr} should exist`);
    assert.strictEqual(attrs[attr].field, col, `${attr} -> ${col}`);
  }
});

test('model timestamps are camelCase createdAt / updatedAt (match table)', () => {
  assert.strictEqual(attrs.createdAt.field, 'createdAt');
  assert.strictEqual(attrs.updatedAt.field, 'updatedAt');
});

test('drifted columns are GONE from the model', () => {
  // No recipient_id / recipient_role / entity_type / created_at anywhere.
  assert.strictEqual(attrs.recipientId, undefined);
  assert.strictEqual(attrs.recipientRole, undefined);
  const fields = Object.values(attrs).map((a) => a.field);
  for (const dead of ['recipient_id', 'recipient_role', 'entity_type', 'created_at', 'updated_at']) {
    assert.ok(!fields.includes(dead), `column "${dead}" must not be mapped`);
  }
});

// ─── Part B: service behavior on a fake tenantDb ─────────────────────────────

/** Minimal in-memory Notification model mimicking the Sequelize API we use. */
function makeFakeTenantDb() {
  let seq = 0;
  let clock = 0;
  const rows = [];

  const matches = (row, where = {}) =>
    Object.entries(where).every(([k, v]) => row[k] === v);

  const model = {
    rows,
    async create(values) {
      const row = {
        id: ++seq,
        createdAt: new Date(2026, 0, 1, 0, 0, ++clock),
        updatedAt: new Date(),
        ...values,
        async update(patch) {
          Object.assign(this, patch);
          return this;
        },
        toJSON() {
          const { update, toJSON, ...rest } = this;
          return rest;
        },
      };
      rows.push(row);
      return row;
    },
    async count({ where } = {}) {
      return rows.filter((r) => matches(r, where)).length;
    },
    async findAndCountAll({ where, order, limit = 20, offset = 0 } = {}) {
      let list = rows.filter((r) => matches(r, where));
      if (order?.[0]?.[0] === 'createdAt') {
        list = [...list].sort((a, b) => b.createdAt - a.createdAt);
      }
      const count = list.length;
      return { count, rows: list.slice(offset, offset + limit) };
    },
    async findByPk(id) {
      return rows.find((r) => r.id === Number(id)) || null;
    },
    async update(patch, { where } = {}) {
      const affected = rows.filter((r) => matches(r, where));
      affected.forEach((r) => Object.assign(r, patch));
      return [affected.length];
    },
  };

  // notifyUser derives organisation_id from the recipient when not supplied.
  return { Notification: model, User: { findByPk: async () => null } };
}

test('create → fetch → unread → mark read → mark all → archive', async () => {
  const db = makeFakeTenantDb();
  const USER = 42;

  // create (no email, no socket)
  const n1 = await notifyUser(db, USER, { title: 'Hello', message: 'first', category: 'case', actionType: 'case_created' });
  const n2 = await notifyUser(db, USER, { title: 'World', message: 'second', category: 'system' });

  assert.ok(n1 && n2, 'notifications created');
  // canonical column: recipient stored under userId, not recipientId
  assert.strictEqual(db.Notification.rows[0].userId, USER);
  assert.strictEqual(db.Notification.rows[0].recipientId, undefined);
  assert.strictEqual(db.Notification.rows[0].actionType, 'case_created');

  // fetch (newest first, excludes archived)
  const list = await getUserNotifications(db, USER, { page: 1, limit: 10 });
  assert.strictEqual(list.total, 2);
  assert.strictEqual(list.notifications[0].id, n2.id, 'newest first');

  // unread count
  assert.strictEqual(await getUnreadCount(db, USER), 2);

  // mark one read
  await markAsRead(db, n1.id);
  assert.strictEqual(n1.isRead, true);
  assert.ok(n1.readAt instanceof Date);
  assert.strictEqual(await getUnreadCount(db, USER), 1);

  // mark all read
  await markAllAsRead(db, USER);
  assert.strictEqual(await getUnreadCount(db, USER), 0);

  // archive removes from the default list
  await setNotificationArchived(db, n2.id, true);
  assert.strictEqual(n2.isArchived, true);
  const afterArchive = await getUserNotifications(db, USER, { page: 1, limit: 10 });
  assert.strictEqual(afterArchive.total, 1, 'archived notification excluded from list');
  assert.strictEqual(afterArchive.notifications[0].id, n1.id);
});

test('unread count is scoped per user (userId isolation)', async () => {
  const db = makeFakeTenantDb();
  await notifyUser(db, 1, { title: 'a', message: 'a' });
  await notifyUser(db, 2, { title: 'b', message: 'b' });
  await notifyUser(db, 2, { title: 'c', message: 'c' });
  assert.strictEqual(await getUnreadCount(db, 1), 1);
  assert.strictEqual(await getUnreadCount(db, 2), 2);
});
