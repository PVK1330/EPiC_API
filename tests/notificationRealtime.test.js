import test from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import { io as Client } from 'socket.io-client';

// A JWT secret must exist before signing the test token (read lazily at sign time).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'realtime-test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaa';

import { initSocketIO } from '../src/realtime/socketServer.js';
import { signToken } from '../src/config/jwt.config.js';
import { notifyUser } from '../src/services/notification.service.js';

/**
 * Integration test for realtime notification delivery.
 *
 * Boots a real Socket.IO server (initSocketIO → registerIO), connects a real
 * socket.io-client, then calls notifyUser() and asserts the client receives
 * BOTH `notification:new` and `notification:count`. This proves the centralized
 * getIO() path replaced the dead tenantDb._io reference.
 */

/** Fake tenant DB: notifyUser only needs Notification.create + count here. */
function fakeTenantDb(unread = 3) {
  return {
    // notifyUser derives organisation_id from the recipient when not supplied.
    User: { findByPk: async () => null },
    Notification: {
      async create(values) {
        const row = { id: 1, ...values };
        return { ...row, toJSON: () => row };
      },
      async count() {
        return unread;
      },
    },
  };
}

function startServer() {
  return new Promise((resolve) => {
    const httpServer = createServer();
    const ioServer = initSocketIO(httpServer, { set() {} }); // stub express app
    httpServer.listen(0, () => resolve({ httpServer, ioServer, port: httpServer.address().port }));
  });
}

test('notifyUser delivers notification:new + notification:count to the user socket', async () => {
  const { httpServer, ioServer, port } = await startServer();
  const token = signToken({ userId: 7, organisation_id: null, role_name: 'admin' });
  const client = Client(`http://localhost:${port}`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  });

  const received = {};
  const bothReceived = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for socket events')), 5000);
    const check = () => {
      if (received.new && received.count) {
        clearTimeout(timer);
        resolve();
      }
    };
    client.on('notification:new', (p) => { received.new = p; check(); });
    client.on('notification:count', (p) => { received.count = p; check(); });
    client.on('connect_error', (e) => { clearTimeout(timer); reject(e); });
  });

  try {
    // Wait for connection (server joins the user:7 room in its connection handler).
    await new Promise((resolve, reject) => {
      client.on('connect', resolve);
      client.on('connect_error', reject);
    });
    // Deterministically wait until the server has joined this socket to the
    // user:7 room (avoids a fixed-tick race that flakes under full-suite load).
    const joinDeadline = Date.now() + 4000;
    while (
      !ioServer.sockets.adapter.rooms.get("user:7")?.size &&
      Date.now() < joinDeadline
    ) {
      await new Promise((r) => setTimeout(r, 20));
    }

    const created = await notifyUser(fakeTenantDb(3), 7, {
      title: 'Realtime',
      message: 'It works',
      category: 'system',
      type: 'info',
    });
    assert.ok(created, 'notifyUser should create and return the notification');

    await bothReceived;

    assert.strictEqual(received.new.title, 'Realtime', 'notification:new payload delivered');
    assert.strictEqual(received.new.userId, 7, 'delivered to the correct user (userId)');
    assert.deepStrictEqual(received.count, { count: 3 }, 'notification:count delivered');
  } finally {
    client.close();
    ioServer.close();
    await new Promise((res) => httpServer.close(res));
  }
});

test('a notification for a different user is NOT delivered to this socket', async () => {
  const { httpServer, ioServer, port } = await startServer();
  const token = signToken({ userId: 7, organisation_id: null });
  const client = Client(`http://localhost:${port}`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  });

  let leaked = false;
  try {
    await new Promise((resolve, reject) => {
      client.on('connect', resolve);
      client.on('connect_error', reject);
    });
    client.on('notification:new', () => { leaked = true; });
    await new Promise((r) => setTimeout(r, 50));

    // Notify a DIFFERENT user (id 999); client (user 7) must not receive it.
    await notifyUser(fakeTenantDb(1), 999, { title: 'Other', message: 'nope' });
    await new Promise((r) => setTimeout(r, 200));

    assert.strictEqual(leaked, false, 'notification must only reach its target user room');
  } finally {
    client.close();
    ioServer.close();
    await new Promise((res) => httpServer.close(res));
  }
});
