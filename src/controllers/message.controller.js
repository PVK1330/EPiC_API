import db from "../models/index.js";
import { Op } from "sequelize";

export const getMessages = async (req, res) => {
  try {
    const { receiverId } = req.params;
    const senderId = req.user.userId;

    const messages = await db.Message.findAll({
      where: {
        [Op.or]: [
          { senderId, receiverId },
          { senderId: receiverId, receiverId: senderId },
        ],
      },
      order: [["createdAt", "ASC"]],
      include: [
        { model: db.User, as: "sender", attributes: ["id", "first_name", "last_name", "role_id"] },
        { model: db.User, as: "receiver", attributes: ["id", "first_name", "last_name", "role_id"] }
      ]
    });

    res.status(200).json({ success: true, count: messages.length, data: messages });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error retrieving messages", error: error.message });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const { receiverId, content } = req.body;
    const senderId = req.user.userId;

    if (!receiverId || !content) {
      return res.status(400).json({ success: false, message: "Receiver ID and content are required." });
    }

    const receiver = await db.User.findByPk(receiverId);
    if (!receiver) {
      return res.status(404).json({ success: false, message: "Receiver not found." });
    }

    const userRole = req.user.role_id;
    // Security check: Candidate/Business can only send to Admin/Caseworker
    if ((userRole === 3 || userRole === 4) && ![1, 2].includes(receiver.role_id)) {
      return res.status(403).json({ success: false, message: "You are not authorized to message this user role." });
    }

    const newMessage = await db.Message.create({
      senderId,
      receiverId,
      content,
    });

    // Populate sender and receiver info
    const messageInfo = await db.Message.findByPk(newMessage.id, {
      include: [
        { model: db.User, as: "sender", attributes: ["id", "first_name", "last_name", "role_id"] },
        { model: db.User, as: "receiver", attributes: ["id", "first_name", "last_name", "role_id"] }
      ]
    });

    // Emit message via WebSockets to both ends to keep history synced across instances
    if (req.app.get('io')) {
      const io = req.app.get('io');
      io.to(receiverId.toString()).emit("newMessage", messageInfo);
      io.to(senderId.toString()).emit("newMessage", messageInfo);
    }

    res.status(201).json({ success: true, data: messageInfo });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error sending message", error: error.message });
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
      attributes: ['id', 'first_name', 'last_name', 'email', 'role_id']
    });

    res.status(200).json({ success: true, count: chatUsers.length, data: chatUsers });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error retrieving chat users", error: error.message });
  }
};

export const markAsRead = async (req, res) => {
  try {
    const { senderId } = req.body;
    const receiverId = req.user.userId;

    await db.Message.update(
      { isRead: true },
      { where: { senderId, receiverId, isRead: false } }
    );

    res.status(200).json({ success: true, message: "Messages marked as read" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating message status", error: error.message });
  }
};
