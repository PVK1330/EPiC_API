import 'dotenv/config';
import app from './app.js';
import db from './models/index.js';
import seedRoles from './seeders/role.seeder.js';
import seedAdmin from './seeders/admin.seeder.js';
import { initializeFieldSettings } from './controllers/AdminControllers/applicationFields.controller.js';
import http from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

const PORT = process.env.PORT || 5000;

db.sequelize.sync().then(async () => {
  console.log('Database connected');
  await seedRoles();
  await seedAdmin();
  await initializeFieldSettings();

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  app.set('io', io);

  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers['token'];
    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) return next(new Error('Authentication error: Invalid token'));
      socket.user = decoded;
      next();
    });
  });

  io.on('connection', (socket) => {
    console.log(`User connected to socket: ${socket.id}, User ID: ${socket.user?.userId}`);

    // User joins their own room identified by their authenticated user ID implicitly
    socket.join(socket.user.userId.toString());
    console.log(`User ${socket.user.userId} joined their secure room`);

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
    });
  });

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to connect to database:', err);
  process.exit(1);
});



// require("dotenv").config();
// const app = require("./app");
// const db = require("./models");
// const seedRoles = require("./seeders/role.seeder");
// const seedAdmin = require("./seeders/admin.seeder");

// const PORT = process.env.PORT || 5000;

// db.sequelize.sync({ alter: true }).then(async () => {
//   console.log("Database connected");

//   // RUN SEEDER HERE
//   await seedRoles();
//   await seedAdmin();

//   app.listen(PORT, () => {
//     console.log(`Server running on port ${PORT}`);
//   });
// });