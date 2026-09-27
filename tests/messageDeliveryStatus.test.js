// Phase 2 UAT 3.4 — message delivery status + cross-firm thread rooms. DB-free.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  messageStatus,
  isUserOnline,
  threadRoom,
  markPendingMessagesDelivered,
  buildMessageNewPayload,
} from "../src/realtime/messagingRealtime.js";

test("status: sent → delivered → read", () => {
  assert.equal(messageStatus({}), "sent");
  assert.equal(messageStatus({ deliveredAt: new Date() }), "delivered");
  assert.equal(messageStatus({ deliveredAt: new Date(), readAt: new Date() }), "read");
  assert.equal(messageStatus({ isRead: true }), "read", "legacy rows read before readAt existed");
  const p = buildMessageNewPayload({ id: 1, senderId: 2, receiverId: 3, content: "x", createdAt: new Date() }, null);
  assert.equal(p.status, "sent");
});

test("presence = any socket in the user's personal room", () => {
  const rooms = new Map([["user:7", new Set(["s1"])]]);
  const io = { sockets: { adapter: { rooms } } };
  assert.equal(isUserOnline(io, 7), true);
  assert.equal(isUserOnline(io, 8), false);
  assert.equal(isUserOnline(null, 7), false);
});

test("thread rooms are scoped by firm (conversation ids repeat across tenants)", () => {
  assert.notEqual(threadRoom(7, 1), threadRoom(7, 2));
  assert.equal(threadRoom(7, 1), "thread:1:7");
});

test("opening the portal delivers waiting messages and tells each sender", async () => {
  const updates = [];
  const emits = [];
  const tenantDb = {
    Message: {
      findAll: async () => [
        { id: 10, senderId: 1, conversationId: 100 },
        { id: 11, senderId: 1, conversationId: 100 },
        { id: 12, senderId: 2, conversationId: 200 },
      ],
      update: async (values, opts) => updates.push({ values, opts }),
    },
  };
  const io = { to: (room) => ({ emit: (evt, payload) => emits.push({ room, evt, payload }) }) };
  const n = await markPendingMessagesDelivered(io, tenantDb, 99);
  assert.equal(n, 3);
  assert.deepEqual(updates[0].opts.where.id, [10, 11, 12]);
  assert.ok(updates[0].values.deliveredAt instanceof Date);
  assert.equal(emits.length, 2, "one event per sender/conversation");
  const toSender1 = emits.find((e) => e.room === "user:1");
  assert.equal(toSender1.evt, "messages:delivered");
  assert.deepEqual(toSender1.payload.messageIds, [10, 11]);
  assert.equal(toSender1.payload.receiverId, 99);
});
