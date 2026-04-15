import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';

import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import adminRoutes from './routes/admin.routes.js';
import adminSettingsRoutes from './routes/admin.settings.routes.js';
import caseworkerRoutes from './routes/caseworker.routes.js';
import sponsorsRoutes from './routes/sponsors.routes.js';
import candidateRoutes from './routes/candidate.routes.js';
import stripeRoutes from './routes/stripe.routes.js';
import caseRoutes from './routes/case.routes.js';
<<<<<<< HEAD
import caseDetailRoutes from './routes/caseDetail.routes.js';
=======
import escalationRoutes from './routes/escalation.routes.js';
import permissionsRoutes from './routes/permissions.routes.js';
import rbacRoutes from './routes/rbac.routes.js';
import roleRoutes from './routes/role.routes.js';
>>>>>>> 96365b2223aad8c6ce5916c68453dc299b57bbf2

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,           
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());       // must be BEFORE any route that reads req.cookies

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
// Mount before /api/admin so paths like /api/admin/settings/me are not captured by /api/admin/:id
app.use('/api/settings', adminSettingsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/caseworker', caseworkerRoutes);
app.use('/api/sponsors', sponsorsRoutes);
app.use('/api/candidate', candidateRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api/cases', caseDetailRoutes);
app.use('/api/escalations', escalationRoutes);
app.use('/api/permissions', permissionsRoutes);
app.use('/api/rbac', rbacRoutes);
app.use('/api/roles', roleRoutes);

export default app;