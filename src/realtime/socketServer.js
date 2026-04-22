import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import db from "../models/index.js";
import { userRoom, threadRoom } from "./messagingRealtime.js";
import { registerIO } from "./ioRegistry.js";
import { getFrontendOrigins } from "../config/frontendOrigins.js";

function extractSocketToken(socket) {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === "string" && authToken.trim()) return authToken.trim();

  const q = socket.handshake.query?.token;
  if (typeof q === "string" && q.trim()) return q.trim();
  if (Array.isArray(q) && q[0] && String(q[0]).trim()) return String(q[0]).trim();

  const raw =
    socket.handshake.headers?.authorization ??
    socket.handshake.headers?.Authorization;
  if (raw && typeof raw === "string") {
    const parts = raw.split(" ");
    if (parts.length === 2 && parts[0].toLowerCase() === "bearer") return parts[1].trim();
  }

  const headerToken = socket.handshake.headers?.token;
  if (typeof headerToken === "string" && headerToken.trim()) return headerToken.trim();

  return null;
}

/**
 * @param {import('http').Server} httpServer
 * @param {import('express').Application} app
 */
export function initSocketIO(httpServer, app) {
  const io = new Server(httpServer, {
    cors: {
      origin: getFrontendOrigins(),
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  registerIO(io);
  app.set("io", io);

  io.use((socket, next) => {
    if (!process.env.JWT_SECRET) {
      return next(new Error("Authentication error: Server misconfiguration"));
    }
    const token = extractSocketToken(socket);
    if (!token) {
      return next(new Error("Authentication error: No token provided"));
    }
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) return next(new Error("Authentication error: Invalid token"));
      if (!decoded?.userId) {
        return next(new Error("Authentication error: Invalid token payload"));
      }
      socket.user = decoded;
      next();
    });
  });

  io.on("connection", (socket) => {
    const uid = Number(socket.user.userId);
    if (!Number.isFinite(uid) || uid <= 0) {
      socket.disconnect(true);
      return;
    }
    socket.join(userRoom(uid));

    socket.on("thread:subscribe", async (payload, ack) => {
      const reply = (result) => {
        if (typeof ack === "function") ack(result);
      };
      try {
        const conversationId = Number(payload?.conversationId);
        if (!Number.isFinite(conversationId) || conversationId <= 0) {
          return reply({ ok: false, error: "conversationId is required" });
        }
        const conv = await db.Conversation.findByPk(conversationId);
        if (!conv) {
          return reply({ ok: false, error: "Conversation not found" });
        }
        if (
          Number(conv.participantOneId) !== uid &&
          Number(conv.participantTwoId) !== uid
        ) {
          return reply({ ok: false, error: "Forbidden" });
        }
        socket.join(threadRoom(conversationId));
        return reply({ ok: true });
      } catch (e) {
        return reply({ ok: false, error: e.message });
      }
    });

    socket.on("thread:unsubscribe", (payload) => {
      const conversationId = Number(payload?.conversationId);
      if (Number.isFinite(conversationId) && conversationId > 0) {
        socket.leave(threadRoom(conversationId));
      }
    });
  });

  return io;
}

