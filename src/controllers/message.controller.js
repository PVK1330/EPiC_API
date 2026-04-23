import db from "../models/index.js";
import { Op } from "sequelize";
import {
  emitMessageNewAndConversationUpdated,
  emitAfterMarkRead,
  getUnreadCountForUserInConversation,
} from "../realtime/messagingRealtime.js";
import { getIO } from "../realtime/ioRegistry.js";

export const getMessages = async (req, res) => {
  try {
    const { receiverId } = req.params;
    const senderId = req.user.userId;
    const userRole = req.user.role_id;
    const { caseId } = req.query;

    const receiver = await db.User.findByPk(receiverId);
    if (!receiver) {
      return res.status(404).json({ status: "error", message: "User not found." });
    }

    if ((userRole === 3 || userRole === 4) && ![1, 2].includes(receiver.role_id)) {
      return res.status(403).json({ status: "error", message: "You are not authorized to view messages with this user role." });
    }

    // Find the conversation
    const conversation = await db.Conversation.findOne({
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

    const messages = await db.Message.findAll({
      where: { conversationId: conversation.id },
      order: [["createdAt", "ASC"]],
      include: [
        { 
          model: db.User, 
          as: "sender", 
          attributes: ["id", "first_name", "last_name", "role_id"],
          include: [{ model: db.Role, as: 'role', attributes: ['name'] }]
        },
        { 
          model: db.User, 
          as: "receiver", 
          attributes: ["id", "first_name", "last_name", "role_id"],
          include: [{ model: db.Role, as: 'role', attributes: ['name'] }]
        }
      ]
    });

    res.status(200).json({ status: "success", message: "Messages retrieved successfully", data: { count: messages.length, messages } });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Error retrieving messages", error: error.message });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const { receiverId, content, caseId, messageType = 'text' } = req.body;
    const senderId = req.user.userId;

    if (!receiverId || !content) {
      return res.status(400).json({ status: "error", message: "Receiver ID and content are required." });
    }

    const receiver = await db.User.findByPk(receiverId);
    if (!receiver) {
      return res.status(404).json({ status: "error", message: "Receiver not found." });
    }

    const userRole = req.user.role_id;
    if ((userRole === 3 || userRole === 4) && ![1, 2].includes(receiver.role_id)) {
      return res.status(403).json({ status: "error", message: "You are not authorized to message this user role." });
    }

    // Find or create conversation
    let conversation = await db.Conversation.findOne({
      where: {
        [Op.or]: [
          { participantOneId: senderId, participantTwoId: receiverId },
          { participantOneId: receiverId, participantTwoId: senderId }
        ],
        ...(caseId && { caseId })
      }
    });

    if (!conversation) {
      conversation = await db.Conversation.create({
        participantOneId: senderId,
        participantTwoId: receiverId,
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

    const newMessage = await db.Message.create({
      senderId,
      receiverId,
      conversationId: conversation.id,
      content,
      messageType
    });

    const messageInfo = await db.Message.findByPk(newMessage.id, {
      include: [
        { 
          model: db.User, 
          as: "sender", 
          attributes: ["id", "first_name", "last_name", "role_id"],
          include: [{ model: db.Role, as: 'role', attributes: ['name'] }]
        },
        { 
          model: db.User, 
          as: "receiver", 
          attributes: ["id", "first_name", "last_name", "role_id"],
          include: [{ model: db.Role, as: 'role', attributes: ['name'] }]
        }
      ]
    });

    await conversation.reload();
    const io = getIO() ?? req.app.get("io");
    await emitMessageNewAndConversationUpdated(io, {
      conversation,
      messageRow: messageInfo,
    });

    res.status(201).json({ status: "success", message: "Message sent successfully", data: messageInfo });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Error sending message", error: error.message });
  }
};

export const getRecentConversations = async (req, res) => {
  try {
    const userId = req.user.userId;

    const conversations = await db.Conversation.findAll({
      where: {
        [Op.or]: [{ participantOneId: userId }, { participantTwoId: userId }]
      },
      order: [['lastMessageAt', 'DESC']],
      include: [
        { 
          model: db.User, 
          as: "participantOne", 
          attributes: ["id", "first_name", "last_name", "role_id"],
          include: [{ model: db.Role, as: 'role', attributes: ['name'] }]
        },
        { 
          model: db.User, 
          as: "participantTwo", 
          attributes: ["id", "first_name", "last_name", "role_id"],
          include: [{ model: db.Role, as: 'role', attributes: ['name'] }]
        },
        { model: db.Case, as: "case", attributes: ["id", "caseId"] }
      ]
    });

    const formattedConversations = await Promise.all(
      conversations.map(async (conv) => {
        const otherUser =
          conv.participantOneId === userId ? conv.participantTwo : conv.participantOne;
        const unreadCount = await getUnreadCountForUserInConversation(userId, conv.id);
        return {
          id: conv.id,
          user: otherUser,
          case: conv.case,
          unreadCount,
          lastMessage: {
            content: conv.lastMessage,
            createdAt: conv.lastMessageAt,
          },
        };
      }),
    );

    res.status(200).json({
      status: "success",
      message: "Conversations retrieved successfully",
      data: { count: formattedConversations.length, conversations: formattedConversations },
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Error retrieving conversations", error: error.message });
  }
};

export const getChatUsers = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role_id;

    // Role logic:
    // Admin (1) and Caseworker (2) can chat with anyone.
    // Candidate (3) and Business (4) can only chat with Admins and Caseworkers.
    let whereClause = { id: { [Op.ne]: userId } };

    if (userRole === 3 || userRole === 4) {
      whereClause.role_id = { [Op.in]: [1, 2] };
    }

    const chatUsers = await db.User.findAll({
      where: whereClause,
      attributes: ['id', 'first_name', 'last_name', 'email', 'role_id'],
      include: [
        { model: db.Role, as: 'role', attributes: ['name'] }
      ]
    });

    res.status(200).json({ status: "success", message: "Chat users retrieved successfully", data: { count: chatUsers.length, users: chatUsers } });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Error retrieving chat users", error: error.message });
  }
};

export const markAsRead = async (req, res) => {
  try {
    const { senderId } = req.body;
    const receiverId = req.user.userId;

    if (senderId == null) {
      return res.status(400).json({ status: "error", message: "senderId is required." });
    }

    const pending = await db.Message.findAll({
      where: { senderId, receiverId, isRead: false },
      attributes: ["conversationId"],
      raw: true,
    });
    const conversationIds = [...new Set(pending.map((r) => r.conversationId))];

    await db.Message.update(
      { isRead: true },
      { where: { senderId, receiverId, isRead: false } }
    );

    const io = getIO() ?? req.app.get("io");
    await emitAfterMarkRead(io, {
      senderId,
      readerUserId: receiverId,
      conversationIds,
    });

    res.status(200).json({ status: "success", message: "Messages marked as read" });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Error updating message status", error: error.message });
  }
};

