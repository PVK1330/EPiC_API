import express from "express";
import { getMessages, sendMessage, getChatUsers, markAsRead } from "../controllers/message.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(verifyToken); // Ensure user is logged in

router.get("/users", getChatUsers);
router.get("/:receiverId", getMessages);
router.post("/", sendMessage);
router.put("/mark-read", markAsRead);

export default router;
