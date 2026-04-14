import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';

import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import adminRoutes from './routes/admin.routes.js';
import caseworkerRoutes from './routes/caseworker.routes.js';
import sponsorsRoutes from './routes/sponsors.routes.js';
import candidateRoutes from './routes/candidate.routes.js';
import stripeRoutes from './routes/stripe.routes.js';
import caseRoutes from './routes/case.routes.js';

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,           // required for cookies to work cross-origin
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());       // must be BEFORE any route that reads req.cookies

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/caseworker', caseworkerRoutes);
app.use('/api/sponsors', sponsorsRoutes);
app.use('/api/candidate', candidateRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/cases', caseRoutes);

export default app;