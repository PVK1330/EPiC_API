import express from 'express';
import { getMessages, sendMessage, getChatUsers, markAsRead, getRecentConversations } from './message.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { handleMessageFileUpload } from '../../../middlewares/upload.middleware.js';

const router = express.Router();

router.use(verifyTokenAndTenant); // Ensure user is logged in

router.get("/conversations", getRecentConversations);
router.get("/users", getChatUsers);
router.get("/:receiverId", getMessages);
router.post("/", handleMessageFileUpload, sendMessage);
router.put("/mark-read", markAsRead);

export default router;

