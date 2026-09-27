import { getIO } from './ioRegistry.js';

export const EVENT_TYPES = Object.freeze({
  NOTIFICATION_NEW: 'notification:new',
  CASE_UPDATED: 'case:updated',
  MESSAGE_NEW: 'message:new',
  CONVERSATION_UPDATED: 'conversation:updated',
  MESSAGES_READ: 'messages:read',
  MESSAGES_DELIVERED: 'messages:delivered',
  LICENCE_STAGE_UPDATED: 'licence:stage_updated',
});

/**
 * Emit an event to a single user's socket room.
 * @param {number} userId
 * @param {string} eventType - one of EVENT_TYPES
 * @param {object} payload
 */
export function emitToUser(userId, eventType, payload = {}) {
  const io = getIO();
  if (!io || !userId) return;
  io.to(userRoom(userId)).emit(eventType, payload);
}

export function userRoom(userId) {
  return `user:${Number(userId)}`;
}

export function threadRoom(conversationId, organisationId = null) {
  return `thread:${Number(organisationId) || 0}:${Number(conversationId)}`;
}

/** Is at least one socket of this user connected (portal open anywhere)? */
export function isUserOnline(io, userId) {
  if (!io || !userId) return false;
  const room = io.sockets?.adapter?.rooms?.get(userRoom(userId));
  return Boolean(room && room.size > 0);
}

const toIso = (v) =>
  v instanceof Date ? v.toISOString() : v ? new Date(v).toISOString() : null;

/**
 * Phase 2 UAT 3.4 — per-message status shown to the sender:
 *   "read"      recipient opened the conversation
 *   "delivered" recipient's portal was open, or they have opened it since
 *   "sent"      saved, waiting for the recipient to open the portal
 * ("failed" only exists client-side: the send request itself failed.)
 */
export function messageStatus(m) {
  if (!m) return "sent";
  if (m.readAt || m.isRead) return "read";
  if (m.deliveredAt) return "delivered";
  return "sent";
}

export function orgRoom(organisationId) {
  return `org:${Number(organisationId)}`;
}

export function buildMessageNewPayload(messageRow, caseId) {
  const m = messageRow?.get ? messageRow.get({ plain: true }) : messageRow;
  const createdAt =
    m.createdAt instanceof Date
      ? m.createdAt.toISOString()
      : m.createdAt
        ? new Date(m.createdAt).toISOString()
        : null;
  return {
    id: m.id,
    senderId: m.senderId,
    receiverId: m.receiverId,
    content: m.content,
    messageType: m.messageType ?? "text",
    isRead: Boolean(m.isRead),
    deliveredAt: toIso(m.deliveredAt),
    readAt: toIso(m.readAt),
    status: messageStatus(m),
    createdAt,
    caseId: caseId ?? null,
  };
}

/** Tell a sender that some of their messages reached the recipient's portal. */
export function emitMessagesDelivered(io, { senderId, receiverId, conversationId, messageIds, deliveredAt }) {
  if (!io || !senderId || !messageIds?.length) return;
  io.to(userRoom(senderId)).emit("messages:delivered", {
    type: "messages:delivered",
    conversationId,
    receiverId,
    messageIds,
    deliveredAt: toIso(deliveredAt),
  });
}

/**
 * The user has just opened the portal (socket connected): every message waiting
 * for them is now delivered. Senders are told so their ticks update.
 */
export async function markPendingMessagesDelivered(io, tenantDb, userId) {
  if (!tenantDb?.Message || !userId) return 0;
  const pending = await tenantDb.Message.findAll({
    where: { receiverId: userId, deliveredAt: null },
    attributes: ["id", "senderId", "conversationId"],
    raw: true,
  });
  if (!pending.length) return 0;
  const now = new Date();
  await tenantDb.Message.update(
    { deliveredAt: now },
    { where: { id: pending.map((p) => p.id), deliveredAt: null } },
  );
  const groups = new Map();
  for (const p of pending) {
    const key = `${p.senderId}:${p.conversationId}`;
    if (!groups.has(key)) groups.set(key, { senderId: p.senderId, conversationId: p.conversationId, ids: [] });
    groups.get(key).ids.push(p.id);
  }
  for (const g of groups.values()) {
    emitMessagesDelivered(io, {
      senderId: g.senderId,
      receiverId: userId,
      conversationId: g.conversationId,
      messageIds: g.ids,
      deliveredAt: now,
    });
  }
  return pending.length;
}

export async function getUnreadCountForUserInConversation(tenantDb, userId, conversationId) {
  return tenantDb.Message.count({
    where: { receiverId: userId, conversationId, isRead: false },
  });
}

function lastMessageEnvelope(content, at) {
  const createdAt =
    at instanceof Date ? at.toISOString() : at ? new Date(at).toISOString() : null;
  return { content: content ?? "", createdAt };
}

/**
 * @param {import('socket.io').Server} io
 */
export async function emitMessageNewAndConversationUpdated(io, {
  tenantDb,
  conversation,
  messageRow,
}) {
  if (!io || !tenantDb) return;

  const caseId = conversation.caseId ?? null;
  const messagePayload = buildMessageNewPayload(messageRow, caseId);
  const conversationId = conversation.id;

  const messageNew = {
    type: "message:new",
    conversationId,
    message: messagePayload,
  };

  io
    .to(userRoom(messagePayload.senderId))
    .to(userRoom(messagePayload.receiverId))
    .emit("message:new", messageNew);

  const p1 = conversation.participantOneId;
  const p2 = conversation.participantTwoId;
  const lastMsg = lastMessageEnvelope(conversation.lastMessage, conversation.lastMessageAt);

  const [u1, u2] = await Promise.all([
    getUnreadCountForUserInConversation(tenantDb, p1, conversationId),
    getUnreadCountForUserInConversation(tenantDb, p2, conversationId),
  ]);

  io.to(userRoom(p1)).emit("conversation:updated", {
    type: "conversation:updated",
    conversationId,
    unreadCount: u1,
    lastMessage: lastMsg,
  });
  io.to(userRoom(p2)).emit("conversation:updated", {
    type: "conversation:updated",
    conversationId,
    unreadCount: u2,
    lastMessage: lastMsg,
  });
}

/**
 * @param {import('socket.io').Server} io
 */
export async function emitAfterMarkRead(io, { tenantDb, senderId, readerUserId, conversationIds, readAt = null }) {
  if (!io || !tenantDb || !conversationIds?.length) return;

  for (const conversationId of conversationIds) {
    const conv = await tenantDb.Conversation.findByPk(conversationId);
    if (!conv) continue;

    const readEvent = {
      type: "messages:read",
      conversationId,
      readerUserId,
      senderId,
      readAt: toIso(readAt || new Date()),
    };
    io.to(userRoom(senderId)).emit("messages:read", readEvent);

    const p1 = conv.participantOneId;
    const p2 = conv.participantTwoId;
    const lastMsg = lastMessageEnvelope(conv.lastMessage, conv.lastMessageAt);
    const [u1, u2] = await Promise.all([
      getUnreadCountForUserInConversation(tenantDb, p1, conversationId),
      getUnreadCountForUserInConversation(tenantDb, p2, conversationId),
    ]);

    io.to(userRoom(p1)).emit("conversation:updated", {
      type: "conversation:updated",
      conversationId,
      unreadCount: u1,
      lastMessage: lastMsg,
    });
    io.to(userRoom(p2)).emit("conversation:updated", {
      type: "conversation:updated",
      conversationId,
      unreadCount: u2,
      lastMessage: lastMsg,
    });
  }
}
