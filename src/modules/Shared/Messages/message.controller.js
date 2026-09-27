import logger from '../../../utils/logger.js';
import { Op } from 'sequelize';
import {
  emitMessageNewAndConversationUpdated,
  emitAfterMarkRead,
  getUnreadCountForUserInConversation,
  isUserOnline,
  messageStatus,
} from '../../../realtime/messagingRealtime.js';
import platformDb from '../../../models/index.js';
import { getIO } from '../../../realtime/ioRegistry.js';
import { notifyMessageReceived } from '../../../services/notification.service.js';
import { buildCaseworkerAssignmentWhere } from '../../../utils/caseworkerScope.js';
import { toPublicImagePath } from '../../../utils/storagePath.util.js';
import { sanitizePlainText } from '../../../utils/sanitizeText.js';

// Normalize a User-like Sequelize row's profile_pic to the canonical relative
// "api/public/images/<basename>" web path (idempotent, null-safe). Mutates the
// row's dataValues in place so the value is correct when serialized to JSON.
const normalizeUserProfilePic = (user) => {
  if (user && 'profile_pic' in user) {
    user.profile_pic = toPublicImagePath(user.profile_pic);
  }
  return user;
};

// Phase 2 UAT 3.4 — where each role reads messages (link in the e-mail nudge).
const MESSAGES_PATH_BY_ROLE = { 1: '/candidate/messages', 2: '/caseworker/messages', 3: '/admin/messages', 4: '/business/messages' };

/**
 * Which of these users have EVER logged in (platform user_sessions)? Used to
 * tell staff "this person hasn't logged in yet — they'll see messages after
 * their first login" (the Phase 2 test candidate never had a working login).
 */
async function getLoggedInUserIds(userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length || !platformDb?.UserSession) return new Set();
  try {
    const rows = await platformDb.UserSession.findAll({
      where: { user_id: { [Op.in]: ids } },
      attributes: ['user_id'],
      group: ['user_id'],
      raw: true,
    });
    return new Set(rows.map((r) => Number(r.user_id)));
  } catch (err) {
    logger.warn({ err }, 'getLoggedInUserIds failed');
    return new Set(ids); // unknown → don't show a misleading "never logged in" badge
  }
}

const withStatus = (row) => {
  if (row?.dataValues) row.dataValues.status = messageStatus(row);
  return row;
};

export const getMessages = async (req, res) => {
  try {
    const { receiverId } = req.params;
    const senderId = req.user.userId;
    const userRole = req.user.role_id;
    const organisationId = req.user.organisation_id;
    const { caseId } = req.query;

    const receiver = await req.tenantDb.User.findOne({
      where: {
        id: receiverId,
        organisation_id: organisationId,
      },
    });
    if (!receiver) {
      return res.status(404).json({ status: "error", message: "User not found." });
    }

    if ((userRole === 1 || userRole === 4) && ![3, 2].includes(receiver.role_id)) {
      return res.status(403).json({ status: "error", message: "You are not authorized to view messages with this user role." });
    }

    // Find the conversation
    const conversation = await req.tenantDb.Conversation.findOne({
      where: {
        [Op.or]: [
          { participantOneId: senderId, participantTwoId: receiverId },
          { participantOneId: receiverId, participantTwoId: senderId }
        ],
        ...(caseId && { caseId })
      }
    });

    if (!conversation) {
      return res.status(200).json({ status: "success", message: "No messages found", data: { count: 0, messages: [] } });
    }

    const messages = await req.tenantDb.Message.findAll({
      where: { conversationId: conversation.id },
      order: [["createdAt", "ASC"]],
      include: [
        { 
          model: req.tenantDb.User, 
          as: "sender", 
          attributes: ["id", "first_name", "last_name", "role_id", "profile_pic"],
          include: [{ model: req.tenantDb.Role, as: 'role', attributes: ['name'] }]
        },
        { 
          model: req.tenantDb.User, 
          as: "receiver", 
          attributes: ["id", "first_name", "last_name", "role_id", "profile_pic"],
          include: [{ model: req.tenantDb.Role, as: 'role', attributes: ['name'] }]
        }
      ]
    });

    messages.forEach((m) => {
      normalizeUserProfilePic(m.sender);
      normalizeUserProfilePic(m.receiver);
      withStatus(m);
    });

    res.status(200).json({ status: "success", message: "Messages retrieved successfully", data: { count: messages.length, messages } });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Error retrieving messages", error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const { receiverId, caseId } = req.body;
    let { content, messageType = 'text' } = req.body;
    const senderId = req.user.userId;
    const organisationId = req.user.organisation_id;

    // SECURITY (stored XSS): message bodies are plain text — strip any HTML so a
    // payload cannot be persisted and later executed by a client that renders it.
    if (typeof content === 'string') {
      content = sanitizePlainText(content, { maxLength: 5000 });
    }

    // Handle file upload if present
    if (req.file) {
      messageType = 'file';
      const fileUrl = `/api/documents/temp/${req.file.filename}`;
      // Store the file metadata as a JSON string in content
      content = JSON.stringify({
        url: fileUrl,
        originalName: req.file.originalname,
        content: content || '' // The actual text message sent along with file
      });
    }

    if (!receiverId || (!content && !req.file)) {
      return res.status(400).json({ status: "error", message: "Receiver ID and content are required." });
    }

    const receiver = await req.tenantDb.User.findOne({
      where: {
        id: receiverId,
        organisation_id: organisationId,
      },
    });
    if (!receiver) {
      return res.status(404).json({ status: "error", message: "Receiver not found." });
    }

    const userRole = req.user.role_id;
    if ((userRole === 1 || userRole === 4) && ![3, 2].includes(receiver.role_id)) {
      return res.status(403).json({ status: "error", message: "You are not authorized to message this user role." });
    }

    // Find or create conversation
    let conversation = await req.tenantDb.Conversation.findOne({
      where: {
        [Op.or]: [
          { participantOneId: senderId, participantTwoId: receiverId },
          { participantOneId: receiverId, participantTwoId: senderId }
        ],
        ...(caseId && { caseId })
      }
    });

    if (!conversation) {
      conversation = await req.tenantDb.Conversation.create({
        participantOneId: senderId,
        participantTwoId: receiverId,
        organisation_id: organisationId ?? null,
        caseId: caseId || null,
        lastMessage: content,
        lastMessageAt: new Date()
      });
    } else {
      await conversation.update({
        lastMessage: content,
        lastMessageAt: new Date()
      });
    }

    // Phase 2 UAT 3.4: if the recipient has the portal open right now the
    // message is delivered immediately; otherwise it is "sent" and becomes
    // delivered when they next open the portal (socketServer on connect).
    const io = getIO() ?? req.app.get("io");
    const recipientOnline = isUserOnline(io, receiverId);

    const newMessage = await req.tenantDb.Message.create({
      senderId,
      receiverId,
      conversationId: conversation.id,
      content,
      messageType,
      organisation_id: organisationId ?? null,
      deliveredAt: recipientOnline ? new Date() : null,
    });

    const messageInfo = await req.tenantDb.Message.findByPk(newMessage.id, {
      include: [
        { 
          model: req.tenantDb.User, 
          as: "sender", 
          attributes: ["id", "first_name", "last_name", "role_id", "profile_pic"],
          include: [{ model: req.tenantDb.Role, as: 'role', attributes: ['name'] }]
        },
        { 
          model: req.tenantDb.User, 
          as: "receiver", 
          attributes: ["id", "first_name", "last_name", "role_id", "profile_pic"],
          include: [{ model: req.tenantDb.Role, as: 'role', attributes: ['name'] }]
        }
      ]
    });

    normalizeUserProfilePic(messageInfo.sender);
    normalizeUserProfilePic(messageInfo.receiver);
    withStatus(messageInfo);

    await conversation.reload();
    await emitMessageNewAndConversationUpdated(io, {
      tenantDb: req.tenantDb,
      conversation,
      messageRow: messageInfo,
    });

    // In-app notification for the receiver. Phase 2 UAT 3.4: when they are NOT
    // in the portal, also e-mail them that a message is waiting — once per
    // batch (only for the first unread message from this sender in this
    // conversation), so a run of messages never becomes a run of e-mails.
    // The e-mail never contains the message text (it may be confidential).
    let emailed = false;
    try {
      const senderName =
        [messageInfo.sender?.first_name, messageInfo.sender?.last_name].filter(Boolean).join(' ') || 'Your adviser';
      let sendEmail = false;
      if (!recipientOnline) {
        const earlierUnread = await req.tenantDb.Message.count({
          where: {
            conversationId: conversation.id,
            senderId,
            receiverId,
            isRead: false,
            id: { [Op.ne]: newMessage.id },
          },
        });
        sendEmail = earlierUnread === 0;
      }
      await notifyMessageReceived(
        req.tenantDb,
        receiverId,
        { conversationId: conversation.id, messageId: newMessage.id, senderId, caseId: conversation.caseId ?? null },
        {
          title: `New message from ${senderName}`,
          message: `${senderName} has sent you a message in the portal. Please log in to read it and reply.`,
          actionUrl: MESSAGES_PATH_BY_ROLE[receiver.role_id] || null,
          organisationId: organisationId ?? null,
          sendEmail,
        },
      );
      emailed = sendEmail;
    } catch (notificationError) {
      logger.error({ err: notificationError }, 'Failed to create message notification');
      // Don't fail the message sending if notification fails
    }

    res.status(201).json({
      status: "success",
      message: "Message sent successfully",
      data: messageInfo,
      // Phase 2 UAT 3.4: tell the sender how the message will reach the person.
      delivery: {
        channel: 'portal',
        status: messageStatus(messageInfo),
        recipientOnline,
        emailNotificationSent: emailed,
      },
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Error sending message", error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

export const getRecentConversations = async (req, res) => {
  try {
    const userId = req.user.userId;
    const organisationId = req.user.organisation_id;

    const conversations = await req.tenantDb.Conversation.findAll({
      where: {
        [Op.or]: [{ participantOneId: userId }, { participantTwoId: userId }]
      },
      order: [['lastMessageAt', 'DESC']],
      include: [
        { 
          model: req.tenantDb.User, 
          as: "participantOne", 
          attributes: ["id", "first_name", "last_name", "role_id", "organisation_id", "profile_pic"],
          include: [{ model: req.tenantDb.Role, as: 'role', attributes: ['name'] }]
        },
        { 
          model: req.tenantDb.User, 
          as: "participantTwo", 
          attributes: ["id", "first_name", "last_name", "role_id", "organisation_id", "profile_pic"],
          include: [{ model: req.tenantDb.Role, as: 'role', attributes: ['name'] }]
        },
        { model: req.tenantDb.Case, as: "case", attributes: ["id", "caseId"] }
      ]
    });

    const loggedIn = await getLoggedInUserIds(
      conversations.flatMap((c) => [c.participantOneId, c.participantTwoId]),
    );
    const formattedConversations = [];
    for (const conv of conversations) {
      const otherUser = conv.participantOneId === userId ? conv.participantTwo : conv.participantOne;
      if (!otherUser) continue;

      // Enforce organisation boundary check (allow superadmin to see all, but isolate tenants)
      if (
        req.user.role_id !== 5 &&
        organisationId != null &&
        otherUser.organisation_id != null &&
        Number(otherUser.organisation_id) !== Number(organisationId)
      ) {
        continue;
      }

      const unreadCount = await getUnreadCountForUserInConversation(req.tenantDb, userId, conv.id);
      normalizeUserProfilePic(otherUser);
      if (otherUser.dataValues) otherUser.dataValues.hasLoggedIn = loggedIn.has(Number(otherUser.id));
      formattedConversations.push({
        id: conv.id,
        user: otherUser,
        case: conv.case,
        unreadCount,
        lastMessage: {
          content: conv.lastMessage,
          createdAt: conv.lastMessageAt,
        },
      });
    }

    res.status(200).json({
      status: "success",
      message: "Conversations retrieved successfully",
      data: { count: formattedConversations.length, conversations: formattedConversations },
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Error retrieving conversations", error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

export const getChatUsers = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role_id;
    const organisationId = req.user.organisation_id;
    const sequelize = req.tenantDb.sequelize;

    // Admin can see everyone in their organization (active only)
    if (userRole === 3) {
      const chatUsers = await req.tenantDb.User.findAll({
        where: {
          id: { [Op.ne]: userId },
          organisation_id: organisationId,
          status: 'active'
        },
        attributes: ['id', 'first_name', 'last_name', 'email', 'role_id', 'profile_pic'],
        include: [{ model: req.tenantDb.Role, as: 'role', attributes: ['name'] }]
      });
      chatUsers.forEach(normalizeUserProfilePic);
      const loggedInIds = await getLoggedInUserIds(chatUsers.map((u) => u.id));
      chatUsers.forEach((u) => { u.dataValues.hasLoggedIn = loggedInIds.has(Number(u.id)); });
      return res.status(200).json({ status: "success", message: "Chat users retrieved successfully", data: { count: chatUsers.length, users: chatUsers } });
    }

    let allowedUserIds = new Set();

    // EVERYONE can always talk to Admins (role_id = 3) in the same organization (active only)
    const admins = await req.tenantDb.User.findAll({
      where: {
        role_id: 3,
        id: { [Op.ne]: userId },
        organisation_id: organisationId,
        status: 'active'
      },
      attributes: ['id']
    });
    admins.forEach(admin => allowedUserIds.add(admin.id));

    if (userRole === 2) { // Caseworker
      const myCases = await req.tenantDb.Case.findAll({
        where: {
          organisation_id: organisationId,
          ...buildCaseworkerAssignmentWhere(sequelize, userId)
        },
        attributes: ['candidateId', 'businessId', 'sponsorId']
      });
      myCases.forEach(c => {
        if (c.candidateId) allowedUserIds.add(c.candidateId);
        if (c.businessId) allowedUserIds.add(c.businessId);
        if (c.sponsorId) allowedUserIds.add(c.sponsorId);
      });
    } else if (userRole === 1) { // Candidate
      const myCases = await req.tenantDb.Case.findAll({
        where: { 
          candidateId: userId,
          organisation_id: organisationId
        },
        attributes: ['businessId', 'sponsorId', 'assignedcaseworkerId']
      });
      myCases.forEach(c => {
        if (c.businessId) allowedUserIds.add(c.businessId);
        if (c.sponsorId) allowedUserIds.add(c.sponsorId);
        if (c.assignedcaseworkerId && Array.isArray(c.assignedcaseworkerId)) {
          c.assignedcaseworkerId.forEach(cwId => allowedUserIds.add(cwId));
        }
      });
    } else if (userRole === 4) { // Business/Sponsor
      const myCases = await req.tenantDb.Case.findAll({
        where: {
          organisation_id: organisationId,
          [Op.or]: [
            { businessId: userId },
            { sponsorId: userId }
          ]
        },
        attributes: ['candidateId', 'assignedcaseworkerId']
      });
      myCases.forEach(c => {
        if (c.candidateId) allowedUserIds.add(c.candidateId);
        if (c.assignedcaseworkerId && Array.isArray(c.assignedcaseworkerId)) {
          c.assignedcaseworkerId.forEach(cwId => allowedUserIds.add(cwId));
        }
      });
    }

    const chatUsers = await req.tenantDb.User.findAll({
      where: {
        id: { [Op.in]: Array.from(allowedUserIds) },
        organisation_id: organisationId,
        status: 'active'
      },
      attributes: ['id', 'first_name', 'last_name', 'email', 'role_id', 'profile_pic'],
      include: [
        { model: req.tenantDb.Role, as: 'role', attributes: ['name'] }
      ]
    });

    chatUsers.forEach(normalizeUserProfilePic);
    const loggedInIds = await getLoggedInUserIds(chatUsers.map((u) => u.id));
    chatUsers.forEach((u) => { u.dataValues.hasLoggedIn = loggedInIds.has(Number(u.id)); });

    res.status(200).json({ status: "success", message: "Chat users retrieved successfully", data: { count: chatUsers.length, users: chatUsers } });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Error retrieving chat users", error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

export const markAsRead = async (req, res) => {
  try {
    const { senderId } = req.body;
    const receiverId = req.user.userId;
    const organisationId = req.user.organisation_id;

    if (senderId == null) {
      return res.status(400).json({ status: "error", message: "senderId is required." });
    }

    const sender = await req.tenantDb.User.findOne({
      where: {
        id: senderId,
        organisation_id: organisationId
      }
    });
    if (!sender) {
      return res.status(404).json({ status: "error", message: "Sender not found." });
    }

    const pending = await req.tenantDb.Message.findAll({
      where: { senderId, receiverId, isRead: false },
      attributes: ["conversationId"],
      raw: true,
    });
    const conversationIds = [...new Set(pending.map((r) => r.conversationId))];

    const readAt = new Date();
    await req.tenantDb.Message.update(
      { deliveredAt: readAt },
      { where: { senderId, receiverId, isRead: false, deliveredAt: null } }
    );
    await req.tenantDb.Message.update(
      { isRead: true, readAt },
      { where: { senderId, receiverId, isRead: false } }
    );

    const io = getIO() ?? req.app.get("io");
    await emitAfterMarkRead(io, {
      tenantDb: req.tenantDb,
      senderId,
      readerUserId: receiverId,
      conversationIds,
      readAt,
    });

    res.status(200).json({ status: "success", message: "Messages marked as read" });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Error updating message status", error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

