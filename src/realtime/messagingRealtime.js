import db from "../models/index.js";

export function userRoom(userId) {
  return `user:${Number(userId)}`;
}

export function threadRoom(conversationId) {
  return `thread:${Number(conversationId)}`;
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
    createdAt,
    caseId: caseId ?? null,
  };
}

export async function getUnreadCountForUserInConversation(userId, conversationId) {
  return db.Message.count({
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
  conversation,
  messageRow,
}) {
  if (!io) return;

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
    .to(threadRoom(conversationId))
    .emit("message:new", messageNew);

  const p1 = conversation.participantOneId;
  const p2 = conversation.participantTwoId;
  const lastMsg = lastMessageEnvelope(conversation.lastMessage, conversation.lastMessageAt);

  const [u1, u2] = await Promise.all([
    getUnreadCountForUserInConversation(p1, conversationId),
    getUnreadCountForUserInConversation(p2, conversationId),
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
export async function emitAfterMarkRead(io, { senderId, readerUserId, conversationIds }) {
  if (!io || !conversationIds?.length) return;

  for (const conversationId of conversationIds) {
    const conv = await db.Conversation.findByPk(conversationId);
    if (!conv) continue;

    const readEvent = {
      type: "messages:read",
      conversationId,
      readerUserId,
      senderId,
    };
    io.to(userRoom(senderId)).emit("messages:read", readEvent);

    const p1 = conv.participantOneId;
    const p2 = conv.participantTwoId;
    const lastMsg = lastMessageEnvelope(conv.lastMessage, conv.lastMessageAt);
    const [u1, u2] = await Promise.all([
      getUnreadCountForUserInConversation(p1, conversationId),
      getUnreadCountForUserInConversation(p2, conversationId),
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
