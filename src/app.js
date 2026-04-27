import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';

import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import adminRoutes from './routes/admin.routes.js';
import adminSettingsRoutes from './routes/admin.settings.routes.js';
import caseworkerRoutes from './routes/caseworker.routes.js';
import caseworkerCaseRoutes from './routes/CaseworkerRoutes/caseworkerCase.routes.js';
import caseworkerDocumentRoutes from './routes/CaseworkerRoutes/caseworkerDocument.routes.js';
import caseworkerCaseNoteRoutes from './routes/CaseworkerRoutes/caseworkerCaseNote.routes.js';
import caseworkerSponsorRoutes from './routes/CaseworkerRoutes/caseworkerSponsor.routes.js';
import sponsorsRoutes from './routes/sponsors.routes.js';
import adminCandidateRoutes from './routes/admin.candidate.routes.js';
import candidatePanelRoutes from './routes/CandidateRoutes/index.js';
import caseRoutes from './routes/case.routes.js';
import escalationRoutes from './routes/escalation.routes.js';
import permissionsRoutes from './routes/permissions.routes.js';
import rbacRoutes from './routes/rbac.routes.js';
import roleRoutes from './routes/role.routes.js';
import caseDetailRoutes from './routes/caseDetail.routes.js';
import caseNoteRoutes from './routes/caseNote.routes.js';
import { taskRoutes, documentRoutes, notificationRoutes } from './routes/index.js';
import applicationFieldsRoutes from './routes/applicationFields.routes.js';
import dashboardRoutes from './routes/admin.dashboard.routes.js';
import workloadRoutes from './routes/admin.workload.routes.js';
import messageRoutes from './routes/message.routes.js';
import reportingRoutes from './routes/reporting.routes.js';
import rescheduleRoutes from './routes/CaseworkerRoutes/reschedule.routes.js';
import auditLogRoutes from './routes/auditLog.routes.js';
import appointmentRoutes from './routes/appointment.routes.js';
import sponsorPanelRoutes from './routes/SponsorRoutes/index.js';
import { getFrontendOrigins } from './config/frontendOrigins.js';

const app = express();

app.use(cors({
  origin: getFrontendOrigins(),
  credentials: true,
}));

// Stripe webhooks must use raw body for signature verification.
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());       // must be BEFORE any route that reads req.cookies
app.use('/uploads', express.static('uploads'));

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
// Mount before /api/admin so paths like /api/admin/settings/me are not captured by /api/admin/:id
app.use('/api/settings', adminSettingsRoutes);
// Mount specific admin sub-routes before the general admin routes to avoid conflicts with /api/admin/:id
app.use('/api/admin/permissions', permissionsRoutes);
app.use('/api/admin/rbac', rbacRoutes);
app.use('/api/admin/roles', roleRoutes);
app.use('/api/admin/audit-logs', auditLogRoutes);
app.use('/api/admin/candidates', adminCandidateRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/caseworker/cases', caseworkerCaseRoutes);
app.use('/api/caseworker/documents', caseworkerDocumentRoutes);
app.use('/api/caseworker/case-notes', caseworkerCaseNoteRoutes);
app.use('/api/caseworker/sponsors', caseworkerSponsorRoutes);
app.use('/api/caseworker', caseworkerRoutes);
app.use('/api/sponsors', sponsorsRoutes);
app.use('/api/business', sponsorPanelRoutes);
app.use('/api/candidate', candidatePanelRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/cases/reschedule', rescheduleRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api/escalations', escalationRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/application-fields', applicationFieldsRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/case-details', caseDetailRoutes);
app.use('/api/case-notes', caseNoteRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/workload', workloadRoutes);
app.use('/api/reports', reportingRoutes);

export default app;