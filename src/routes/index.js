import { Router } from 'express';

// Modules
import authRoutes from '../modules/Auth/auth.routes.js';
import userRoutes from '../modules/Auth/user.routes.js';
import adminRoutes from '../modules/Admin/Dashboard/admin.routes.js';
import adminAnnouncementRoutes from '../modules/Admin/Announcements/admin.announcements.routes.js';
import adminSettingsRoutes from '../modules/Admin/Settings/admin.settings.routes.js';
import adminDocumentChecklistRoutes from '../modules/Admin/Settings/admin.documentChecklist.routes.js';
import adminCandidateRoutes from '../modules/Admin/Candidates/candidate.routes.js';
import adminLicenceRoutes from '../modules/Admin/Settings/admin.licence.routes.js';
import dashboardRoutes from '../modules/Admin/Dashboard/admin.dashboard.routes.js';
import workloadRoutes from '../modules/Admin/Dashboard/admin.workload.routes.js';
import reportingRoutes from '../modules/Admin/Reporting/reporting.routes.js';
import auditLogRoutes from '../modules/Admin/AuditLogs/auditLog.routes.js';
import permissionsRoutes from '../modules/Admin/Permissions/permissions.routes.js';
import rbacRoutes from '../modules/Admin/Permissions/rbac.routes.js';
import roleRoutes from '../modules/Admin/Roles/role.routes.js';

import caseworkerRoutes from '../modules/Caseworker/Cases/caseworker.routes.js';
import caseworkerCaseRoutes from '../modules/Caseworker/Cases/caseworkerCase.routes.js';
import caseworkerDocumentRoutes from '../modules/Caseworker/Documents/caseworkerDocument.routes.js';
import caseworkerCaseNoteRoutes from '../modules/Caseworker/Cases/caseworkerCaseNote.routes.js';
import caseworkerSponsorRoutes from '../modules/Caseworker/Sponsors/caseworkerSponsor.routes.js';
import caseworkerAuditRoutes from '../modules/Caseworker/Audit/caseworkerAudit.routes.js';
import caseworkerLicenceRoutes from '../modules/Caseworker/Cases/caseworker.licence.routes.js';
import caseworkerTimelineRoutes from '../modules/Caseworker/Cases/caseTimeline.routes.js';
import caseworkerPerformanceRoutes from '../modules/Caseworker/Performance/caseworkerPerformance.routes.js';
import rescheduleRoutes from '../modules/Caseworker/Cases/reschedule.routes.js';

import sponsorsRoutes from '../modules/Shared/Cases/sponsors.routes.js';
import caseRoutes from '../modules/Shared/Cases/case.routes.js';
import caseDetailRoutes from '../modules/Shared/Cases/caseDetail.routes.js';
import caseNoteRoutes from '../modules/Shared/Cases/caseNote.routes.js';
import { taskRoutes, documentRoutes, notificationRoutes } from '../modules/Shared/index.js';
import applicationFieldsRoutes from '../modules/Shared/Cases/applicationFields.routes.js';
import messageRoutes from '../modules/Shared/Messages/message.routes.js';
import appointmentRoutes from '../modules/Shared/Appointments/appointment.routes.js';
import calendarRoutes from '../modules/Shared/Calendar/calendar.routes.js';
import microsoftRoutes from '../modules/Shared/Integrations/microsoft.routes.js';
import teamsMeetingRoutes from '../modules/Shared/Integrations/teamsMeeting.routes.js';
import escalationRoutes from '../modules/Shared/Cases/escalation.routes.js';

import candidatePanelRoutes from '../modules/Candidate/index.js';
import workflowRoutes from '../modules/Shared/Workflow/workflow.routes.js';
import sponsorPanelRoutes from '../modules/Sponsor/index.js';
import superadminRoutes from '../modules/Superadmin/superadmin.routes.js';

const router = Router();

// Auth & User
router.use('/auth', authRoutes);
router.use('/user', userRoutes);

// Admin
router.use('/settings', adminSettingsRoutes);
router.use('/admin/permissions', permissionsRoutes);
router.use('/admin/rbac', rbacRoutes);
router.use('/admin/roles', roleRoutes);
router.use('/admin/audit-logs', auditLogRoutes);
router.use('/admin/candidates', adminCandidateRoutes);
router.use('/admin/document-checklists', adminDocumentChecklistRoutes);
router.use('/admin/licence', adminLicenceRoutes);
router.use('/admin/announcements', adminAnnouncementRoutes);
router.use('/admin', adminRoutes);

// Caseworker
router.use('/caseworker/cases', caseworkerCaseRoutes);
router.use('/caseworker/documents', caseworkerDocumentRoutes);
router.use('/caseworker/case-notes', caseworkerCaseNoteRoutes);
router.use('/caseworker/sponsors', caseworkerSponsorRoutes);
router.use('/caseworker/audit', caseworkerAuditRoutes);
router.use('/caseworker/licence', caseworkerLicenceRoutes);
router.use('/caseworker', caseworkerTimelineRoutes);
router.use('/caseworker', caseworkerPerformanceRoutes);
router.use('/caseworker', caseworkerRoutes);

// Shared / Domain
router.use('/sponsors', sponsorsRoutes);
router.use('/business', sponsorPanelRoutes);
router.use('/candidate', candidatePanelRoutes);
router.use('/workflow', workflowRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/calendar', calendarRoutes);
router.use('/microsoft', microsoftRoutes);
router.use('/teams-meetings', teamsMeetingRoutes);
router.use('/cases/reschedule', rescheduleRoutes);
router.use('/cases', caseRoutes);
router.use('/escalations', escalationRoutes);
router.use('/tasks', taskRoutes);
router.use('/documents', documentRoutes);
router.use('/notifications', notificationRoutes);
router.use('/application-fields', applicationFieldsRoutes);
router.use('/messages', messageRoutes);
router.use('/case-details', caseDetailRoutes);
router.use('/case-notes', caseNoteRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/workload', workloadRoutes);
router.use('/reports', reportingRoutes);

// Superadmin
router.use('/superadmin', superadminRoutes);

export default router;
